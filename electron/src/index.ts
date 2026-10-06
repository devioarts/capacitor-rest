import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  createRequest,
  discoverUrls,
  estimateBodySize,
  inferBodyType,
  listJobs,
  normalizeHeaders,
  normalizeIncomingHeaders,
  normalizeMethod,
  normalizeResponse,
  normalizeRoute,
  parseQuery,
  pathSegments,
  randomId,
  readRequestBody,
  routeKey,
  withCors,
  writeResponse,
} from './helpers';
import { authorize, matchRoute, requireJob, requireOpenJob, trySystemRoute } from './request-handling';
import {
  BodyTooLargeError,
  DEFAULT_HOST,
  DEFAULT_JOB_RETENTION_MS,
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_RETAINED_JOBS,
  DEFAULT_TIMEOUT_MS,
  PluginPlatform,
  STOP_GRACE_MS,
  ServerStoppedError,
  TERMINAL_JOB_STATUSES,
} from './types';
import type {
  BodyType,
  JobInfo,
  JobStatus,
  ListJobsOptions,
  ListJobsResult,
  PendingRequest,
  RestMethod,
  RestRequest,
  RestResponse,
  RouteInfo,
  RouteOptions,
  RouteRecord,
  ServerInfo,
  StartOptions,
} from './types';

export class CapacitorREST {
  // Listener counts are tracked per WebContents: with several windows each one registers its
  // own listeners, and a renderer reload (which does not destroy the WebContents) drops all of
  // its JS listeners without sending any `event-remove-*` message.
  private listeners = new Map<WebContents, Map<string, number>>();
  private server?: Server;
  private options?: Required<
    Pick<StartOptions, 'host' | 'port' | 'requestTimeoutMs' | 'jobRetentionMs' | 'maxBodySizeBytes' | 'maxRetainedJobs'>
  > &
    StartOptions;
  private routes = new Map<string, RouteRecord>();
  private pending = new Map<string, PendingRequest>();
  private jobs = new Map<string, JobInfo>();

  constructor() {
    ipcMain.on('event-add-CapacitorREST', (event, type: unknown) => {
      const counts = this.attachWebContents(event.sender);
      const eventType = String(type);
      counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
    });

    for (const eventName of ['request', 'started', 'stopped', 'error', 'jobUpdated']) {
      ipcMain.on(`event-remove-CapacitorREST-${eventName}`, (event) => {
        const counts = this.listeners.get(event.sender);
        if (!counts) return;
        counts.set(eventName, Math.max(0, (counts.get(eventName) ?? 1) - 1));
      });
    }
  }

  async start(options: StartOptions): Promise<ServerInfo> {
    const authType = options.auth?.type as string | undefined;
    if (authType && authType !== 'none' && authType !== 'bearer') {
      throw new Error("auth.type must be 'none' or 'bearer'");
    }
    if (options.auth?.type === 'bearer' && !options.auth.token) {
      throw new Error("auth.token is required when auth.type is 'bearer'");
    }
    // Intentionally leaves this.jobs and their expiry timers untouched across a restart -
    // job retention is decoupled from server lifecycle, so queued/running async jobs keep
    // running (and can still complete/expire and fire jobUpdated) even while running:false.
    await this.stop();
    this.options = {
      ...options,
      host: options.host ?? DEFAULT_HOST,
      port: options.port,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      jobRetentionMs: options.jobRetentionMs ?? DEFAULT_JOB_RETENTION_MS,
      maxBodySizeBytes: options.maxBodySizeBytes ?? DEFAULT_MAX_BODY_SIZE_BYTES,
      maxRetainedJobs: options.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS,
    };

    const server = createServer((request, response) => {
      // Without these, a client aborting mid-request (or another socket-level failure) emits
      // an unhandled 'error' event on the request/response, which Node turns into an uncaught
      // exception - risking a crash of the whole Electron main process rather than just this
      // one connection.
      request.on('error', (error) => {
        this.emit('error', { message: error instanceof Error ? error.message : String(error) });
      });
      response.on('error', (error) => {
        this.emit('error', { message: error instanceof Error ? error.message : String(error) });
      });
      this.handleHttpRequest(request, response).catch((error) => {
        this.emit('error', { message: error instanceof Error ? error.message : String(error) });
        writeResponse(
          response,
          withCors(this.options, request.headers.origin, {
            status: error instanceof BodyTooLargeError ? 413 : 500,
            bodyType: 'json',
            body: { error: error instanceof Error ? error.message : String(error) },
          }),
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onListenError = (error: Error) => reject(error);
      server.once('error', onListenError);
      server.listen(this.options?.port, this.options?.host, () => {
        server.off('error', onListenError);
        resolve();
      });
    });
    // Only publish the server once it is really listening, so a failed start() (e.g.
    // EADDRINUSE) never leaves getInfo() reporting `running: true`.
    this.server = server;
    server.on('error', (error) => {
      this.emit('error', { message: error.message });
    });

    const info = await this.getInfo();
    this.emit('started', { info });
    return info;
  }

  async stop(): Promise<void> {
    // Reject pending requests *before* awaiting server.close(): Node's http.Server.close()
    // callback only fires once every existing connection ends, and an in-flight sync
    // request's connection won't end until its pending promise settles and the response is
    // written. Awaiting close() first would deadlock waiting on a connection that can only
    // finish after this same function rejects it.
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ServerStoppedError());
    }
    this.pending.clear();

    const server = this.server;
    this.server = undefined;

    if (server) {
      // close() only resolves once every connection has ended. Idle keep-alive connections are
      // dropped immediately; connections still busy (e.g. a slow upload) get a short grace
      // period to finish writing their 503 and are then closed forcibly, so stop() can never
      // hang on a single stuck client.
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server.closeIdleConnections();
      const force = setTimeout(() => server.closeAllConnections(), STOP_GRACE_MS);
      try {
        await closed;
      } finally {
        clearTimeout(force);
      }
    }

    this.emit('stopped', { info: await this.getInfo() });
  }

  getPluginPlatform(): PluginPlatform {
    return 'electron';
  }

  async getInfo(): Promise<ServerInfo> {
    const address = this.server?.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
      running: this.server !== undefined,
      host: this.options?.host ?? DEFAULT_HOST,
      port,
      urls: this.server ? discoverUrls(port) : [],
      mock: false,
    };
  }

  async registerRoute(options: RouteOptions): Promise<RouteInfo> {
    const route = normalizeRoute(options);
    this.routes.set(routeKey(route.method, route.path), {
      ...route,
      segments: pathSegments(route.path),
    });
    return route;
  }

  async unregisterRoute(options: { method: RestMethod; path: string }): Promise<void> {
    this.routes.delete(routeKey(options.method, options.path));
  }

  async clearRoutes(): Promise<void> {
    this.routes.clear();
  }

  async respond(options: RestResponse & { requestId: string }): Promise<void> {
    const pending = this.pending.get(options.requestId);
    if (!pending) {
      throw new Error(`Request ${options.requestId} is not pending`);
    }
    // Normalize first: if the response is malformed this throws while the request is still
    // pending, so the caller can retry and the request is not left hanging with no timer.
    let response: RestResponse;
    try {
      response = normalizeResponse(options);
    } catch (error) {
      throw new Error(
        `Invalid response for request ${options.requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    clearTimeout(pending.timeout);
    this.pending.delete(options.requestId);
    pending.resolve(response);
  }

  async completeJob(options: { jobId: string; response: RestResponse }): Promise<JobInfo> {
    const job = requireOpenJob(this.jobs, options.jobId);
    const updated = {
      ...job,
      status: 'completed' as const,
      response: normalizeResponse(options.response),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(options.jobId, updated);
    this.enforceJobRetentionCap();
    this.emit('jobUpdated', { job: updated });
    return updated;
  }

  async failJob(options: {
    jobId: string;
    error: string;
    status?: Extract<JobStatus, 'failed' | 'cancelled'>;
  }): Promise<JobInfo> {
    const job = requireOpenJob(this.jobs, options.jobId);
    if (options.status !== undefined && options.status !== 'failed' && options.status !== 'cancelled') {
      throw new Error("status must be 'failed' or 'cancelled'");
    }
    const updated = {
      ...job,
      status: options.status ?? ('failed' as const),
      error: options.error,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(options.jobId, updated);
    this.enforceJobRetentionCap();
    this.emit('jobUpdated', { job: updated });
    return updated;
  }

  /**
   * Evicts the oldest terminal-state jobs (never `queued`/`running`) once the retained job
   * count exceeds `maxRetainedJobs`, so a client that never calls `deleteJob()` can't grow
   * the job map - and the full request/response bodies it holds - without bound.
   */
  private enforceJobRetentionCap(): void {
    const cap = this.options?.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS;
    let excess = this.jobs.size - cap;
    if (excess <= 0) {
      return;
    }
    const terminalJobs = [...this.jobs.values()]
      .filter((job) => TERMINAL_JOB_STATUSES.has(job.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const job of terminalJobs) {
      if (excess <= 0) {
        break;
      }
      this.jobs.delete(job.jobId);
      excess -= 1;
    }
  }

  async getJob(options: { jobId: string }): Promise<JobInfo> {
    return requireJob(this.jobs, options.jobId);
  }

  async listJobs(options: ListJobsOptions = {}): Promise<ListJobsResult> {
    return { jobs: listJobs(this.jobs, options.status) };
  }

  async deleteJob(options: { jobId: string }): Promise<void> {
    this.jobs.delete(options.jobId);
  }

  async mockRequest(options: {
    method: RestMethod;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: BodyType;
    remoteAddress?: string;
  }): Promise<RestResponse> {
    if (!this.server || !this.options) {
      throw new Error('Server is not running');
    }

    const method = normalizeMethod(options.method);
    const url = new URL(options.path, 'http://electron.local');
    const requestOrigin = normalizeHeaders(options.headers).origin;

    // Unlike handleHttpRequest() (which intercepts OPTIONS before ever calling this method,
    // see below), a direct mockRequest({method:'OPTIONS'}) call has no other short-circuit -
    // without this it would fall through to the body-size/auth/route checks below and
    // typically 404 instead of returning a preflight 204.
    if (method === 'OPTIONS') {
      return withCors(this.options, requestOrigin, { status: 204, bodyType: 'empty' });
    }

    if (estimateBodySize(options.body, options.bodyType) > this.options.maxBodySizeBytes) {
      return withCors(this.options, requestOrigin, {
        status: 413,
        bodyType: 'json',
        body: { error: 'Payload too large' },
      });
    }

    const authResponse = authorize(this.options.auth, options.headers ?? {});
    if (authResponse) return withCors(this.options, requestOrigin, authResponse);

    const systemResponse = trySystemRoute(this.jobs, method, url.pathname, url.searchParams);
    if (systemResponse) return withCors(this.options, requestOrigin, systemResponse);

    const match = matchRoute(this.routes, method, url.pathname);
    if (!match) {
      return withCors(this.options, requestOrigin, {
        status: 404,
        bodyType: 'json',
        body: { error: 'Route not found' },
      });
    }

    const request = createRequest({
      route: match.route.path,
      method,
      path: url.pathname,
      params: match.params,
      query: parseQuery(url.searchParams),
      headers: normalizeHeaders(options.headers),
      body: options.body,
      bodyType: options.bodyType ?? inferBodyType(options.body),
      remoteAddress: options.remoteAddress,
    });

    if (match.route.mode === 'async') {
      const job = this.createJob(request);
      this.emit('request', job.request ?? request);
      return withCors(this.options, requestOrigin, {
        status: 202,
        bodyType: 'json',
        headers: { location: `/__jobs/${job.jobId}` },
        body: { jobId: job.jobId, status: job.status, location: `/__jobs/${job.jobId}` },
      });
    }

    const timeoutMs = match.route.timeoutMs ?? this.options.requestTimeoutMs;
    const responsePromise = new Promise<RestResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Request ${request.id} timed out`));
      }, timeoutMs);
      this.pending.set(request.id, { resolve, reject, timeout });
    });

    this.emit('request', request);

    try {
      return withCors(this.options, requestOrigin, await responsePromise);
    } catch (error) {
      return withCors(this.options, requestOrigin, {
        status: error instanceof ServerStoppedError ? 503 : 504,
        bodyType: 'json',
        body: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private attachWebContents(webContents: WebContents): Map<string, number> {
    const existing = this.listeners.get(webContents);
    if (existing) return existing;
    const counts = new Map<string, number>();
    this.listeners.set(webContents, counts);
    webContents.once('destroyed', () => {
      this.listeners.delete(webContents);
    });
    // A main-frame navigation or reload discards the page's JS listeners without telling us,
    // so forget the old counts - the new page registers its own via `event-add-*`.
    webContents.on('did-navigate', () => {
      counts.clear();
    });
    return counts;
  }

  private emit(eventName: string, payload: object): void {
    for (const [webContents, counts] of this.listeners) {
      if ((counts.get(eventName) ?? 0) <= 0) continue;
      if (webContents.isDestroyed()) continue;
      webContents.send(`event-CapacitorREST-${eventName}`, payload);
    }
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      writeResponse(response, withCors(this.options, request.headers.origin, { status: 204, bodyType: 'empty' }));
      return;
    }
    const body = await readRequestBody(request, this.options?.maxBodySizeBytes ?? DEFAULT_MAX_BODY_SIZE_BYTES);
    const restResponse = await this.mockRequest({
      method: (request.method ?? 'GET').toUpperCase() as RestMethod,
      path: request.url ?? '/',
      headers: normalizeIncomingHeaders(request.headers),
      body: body.body,
      bodyType: body.bodyType,
      remoteAddress: request.socket.remoteAddress,
    });
    writeResponse(response, restResponse);
  }

  private createJob(request: RestRequest): JobInfo {
    const now = new Date().toISOString();
    const jobId = randomId();
    const job: JobInfo = {
      jobId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      request: { ...request, jobId },
    };
    this.jobs.set(jobId, job);
    const expiryTimer = setTimeout(() => {
      const current = this.jobs.get(jobId);
      if (current && (current.status === 'queued' || current.status === 'running')) {
        const updated = { ...current, status: 'expired' as const, updatedAt: new Date().toISOString() };
        this.jobs.set(jobId, updated);
        this.enforceJobRetentionCap();
        this.emit('jobUpdated', { job: updated });
      }
    }, this.options?.jobRetentionMs ?? DEFAULT_JOB_RETENTION_MS);
    expiryTimer.unref();
    return job;
  }
}
