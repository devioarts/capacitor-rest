import { WebPlugin } from '@capacitor/core';

import type {
  CapacitorRESTPlugin,
  CompleteJobOptions,
  FailJobOptions,
  JobIdOptions,
  JobInfo,
  ListJobsOptions,
  ListJobsResult,
  MockRequestOptions,
  PluginPlatform,
  RemoveRouteOptions,
  RespondOptions,
  RestRequest,
  RestResponse,
  RouteInfo,
  RouteOptions,
  ServerInfo,
  StartOptions,
} from './definitions';
import {
  DEFAULT_HOST,
  DEFAULT_JOB_RETENTION_MS,
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_RETAINED_JOBS,
  DEFAULT_TIMEOUT_MS,
  ServerStoppedError,
  createRequest,
  estimateBodySize,
  inferBodyType,
  listJobs as listJobsOf,
  normalizeHeaders,
  normalizeMethod,
  normalizeRoute,
  normalizeResponse,
  parseQuery,
  pathSegments,
  randomId,
  routeKey,
} from './web-helpers';
import type { PendingRequest, RouteRecord } from './web-helpers';
import {
  authorize,
  enforceJobRetentionCap,
  matchRoute,
  requireJob,
  requireOpenJob,
  trySystemRoute,
  withCors,
} from './web-request-handling';

export class CapacitorRESTWeb extends WebPlugin implements CapacitorRESTPlugin {
  private options: StartOptions | undefined;
  private routes = new Map<string, RouteRecord>();
  private pending = new Map<string, PendingRequest>();
  private jobs = new Map<string, JobInfo>();

  async start(options: StartOptions): Promise<ServerInfo> {
    const authType = options.auth?.type as string | undefined;
    if (authType && authType !== 'none' && authType !== 'bearer') {
      throw new Error("auth.type must be 'none' or 'bearer'");
    }
    if (options.auth?.type === 'bearer' && !options.auth.token) {
      throw new Error("auth.token is required when auth.type is 'bearer'");
    }
    this.options = {
      host: options.host ?? DEFAULT_HOST,
      requestTimeoutMs: DEFAULT_TIMEOUT_MS,
      jobRetentionMs: DEFAULT_JOB_RETENTION_MS,
      maxBodySizeBytes: DEFAULT_MAX_BODY_SIZE_BYTES,
      maxRetainedJobs: DEFAULT_MAX_RETAINED_JOBS,
      ...options,
    };
    const info = await this.getInfo();
    await this.notifyListeners('started', { info });
    return info;
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ServerStoppedError());
    }
    this.pending.clear();
    this.options = undefined;
    await this.notifyListeners('stopped', {
      info: await this.getInfo(),
    });
  }

  async getInfo(): Promise<ServerInfo> {
    return {
      running: this.options !== undefined,
      host: this.options?.host ?? DEFAULT_HOST,
      port: 0,
      urls: [],
      mock: true,
    };
  }

  getPluginPlatform(): PluginPlatform {
    return 'web';
  }

  async registerRoute(options: RouteOptions): Promise<RouteInfo> {
    const route = normalizeRoute(options);
    this.routes.set(routeKey(route.method, route.path), {
      ...route,
      segments: pathSegments(route.path),
    });
    return route;
  }

  async unregisterRoute(options: RemoveRouteOptions): Promise<void> {
    this.routes.delete(routeKey(options.method, options.path));
  }

  async clearRoutes(): Promise<void> {
    this.routes.clear();
  }

  async respond(options: RespondOptions): Promise<void> {
    const pending = this.pending.get(options.requestId);
    if (!pending) {
      throw new Error(`Request ${options.requestId} is not pending`);
    }
    clearTimeout(pending.timeout);
    this.pending.delete(options.requestId);
    pending.resolve(normalizeResponse(options));
  }

  async completeJob(options: CompleteJobOptions): Promise<JobInfo> {
    const job = requireOpenJob(this.jobs, options.jobId);
    const updated = {
      ...job,
      status: 'completed' as const,
      response: normalizeResponse(options.response),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(options.jobId, updated);
    enforceJobRetentionCap(this.jobs, this.options?.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS);
    await this.notifyListeners('jobUpdated', { job: updated });
    return updated;
  }

  async failJob(options: FailJobOptions): Promise<JobInfo> {
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
    enforceJobRetentionCap(this.jobs, this.options?.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS);
    await this.notifyListeners('jobUpdated', { job: updated });
    return updated;
  }

  async getJob(options: JobIdOptions): Promise<JobInfo> {
    return requireJob(this.jobs, options.jobId);
  }

  async listJobs(options: ListJobsOptions = {}): Promise<ListJobsResult> {
    return { jobs: listJobsOf(this.jobs, options.status) };
  }

  async deleteJob(options: JobIdOptions): Promise<void> {
    this.jobs.delete(options.jobId);
  }

  async mockRequest(options: MockRequestOptions): Promise<RestResponse> {
    if (!this.options) {
      throw new Error('Server is not running');
    }

    const method = normalizeMethod(options.method);
    const url = new URL(options.path, 'http://mock.local');
    const requestOrigin = normalizeHeaders(options.headers).origin;

    // OPTIONS is checked before the body-size limit so a preflight request always gets a
    // plain 204, regardless of what a caller happens to put in a mocked OPTIONS call's
    // body/bodyType (matches Android/iOS/Electron).
    if (method === 'OPTIONS') {
      return withCors(
        this.options?.cors,
        {
          status: 204,
          bodyType: 'empty',
        },
        requestOrigin,
      );
    }

    if (
      estimateBodySize(options.body, options.bodyType) > (this.options.maxBodySizeBytes ?? DEFAULT_MAX_BODY_SIZE_BYTES)
    ) {
      return withCors(
        this.options?.cors,
        {
          status: 413,
          bodyType: 'json',
          body: { error: 'Payload too large' },
        },
        requestOrigin,
      );
    }

    const authResponse = authorize(this.options?.auth, options.headers ?? {});
    if (authResponse) {
      return withCors(this.options?.cors, authResponse, requestOrigin);
    }

    const systemResponse = trySystemRoute(this.jobs, method, url.pathname, url.searchParams);
    if (systemResponse) {
      return withCors(this.options?.cors, systemResponse, requestOrigin);
    }

    const match = matchRoute(this.routes, method, url.pathname);
    if (!match) {
      return withCors(
        this.options?.cors,
        {
          status: 404,
          bodyType: 'json',
          body: { error: 'Route not found' },
        },
        requestOrigin,
      );
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
      await this.notifyListeners('request', job.request ?? request);
      return withCors(
        this.options?.cors,
        {
          status: 202,
          bodyType: 'json',
          headers: { location: `/__jobs/${job.jobId}` },
          body: {
            jobId: job.jobId,
            status: job.status,
            location: `/__jobs/${job.jobId}`,
          },
        },
        requestOrigin,
      );
    }

    const timeoutMs = match.route.timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const responsePromise = new Promise<RestResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Request ${request.id} timed out`));
      }, timeoutMs);
      this.pending.set(request.id, { resolve, reject, timeout });
    });

    await this.notifyListeners('request', request);

    try {
      return withCors(this.options?.cors, await responsePromise, requestOrigin);
    } catch (error) {
      return withCors(
        this.options?.cors,
        {
          status: error instanceof ServerStoppedError ? 503 : 504,
          bodyType: 'json',
          body: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
        requestOrigin,
      );
    }
  }

  private createJob(request: RestRequest): JobInfo {
    const now = new Date().toISOString();
    const jobId = randomId();
    const jobRequest = {
      ...request,
      jobId,
    };
    const job: JobInfo = {
      jobId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      request: jobRequest,
    };
    this.jobs.set(job.jobId, job);
    this.scheduleJobExpiry(job.jobId);
    return job;
  }

  // Not cancelled when the job completes/fails early - the check inside the callback below
  // just no-ops on a stale timer rather than this class tracking a cancellable handle per job.
  // Also note stop() (above) never touches queued/running jobs or these timers: job retention
  // is decoupled from server lifecycle.
  private scheduleJobExpiry(jobId: string): void {
    const retentionMs = this.options?.jobRetentionMs ?? DEFAULT_JOB_RETENTION_MS;
    setTimeout(() => {
      const job = this.jobs.get(jobId);
      if (job && job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
        const updated = {
          ...job,
          status: 'expired',
          updatedAt: new Date().toISOString(),
        } as const;
        this.jobs.set(jobId, updated);
        enforceJobRetentionCap(this.jobs, this.options?.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS);
        void this.notifyListeners('jobUpdated', { job: updated });
      }
    }, retentionMs);
  }
}
