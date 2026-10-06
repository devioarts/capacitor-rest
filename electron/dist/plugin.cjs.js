'use strict';

var electron = require('electron');
var node_http = require('node:http');
var node_crypto = require('node:crypto');
var node_os = require('node:os');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_JOB_RETENTION_MS = 300000;
const DEFAULT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_JOBS = 1000;
/** How long stop() lets busy connections finish before closing them forcibly. */
const STOP_GRACE_MS = 1000;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
/**
 * Distinguishes an explicit `stop()` call from a genuine request timeout so a pending
 * synchronous request can resolve with `503` (stopped) instead of `504` (timed out).
 */
class ServerStoppedError extends Error {
    constructor() {
        super('Server stopped');
    }
}
class BodyTooLargeError extends Error {
    constructor(maxBodySizeBytes) {
        super(`Payload too large. Maximum request body size is ${maxBodySizeBytes} bytes`);
    }
}

function normalizeRoute(options) {
    return omitUndefined({
        method: normalizeMethod(options.method),
        path: normalizePath(options.path),
        mode: options.mode ?? 'sync',
        timeoutMs: options.timeoutMs,
    });
}
function normalizeResponse(response) {
    return omitUndefined({
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: response.body,
        bodyType: response.bodyType ?? inferBodyType(response.body),
    });
}
/**
 * Removes properties whose value is `undefined` so objects returned to callers have the same
 * key set on every platform (matches the Web mock's `omitUndefined`, see src/web.ts).
 */
function omitUndefined(value) {
    const result = {};
    for (const key of Object.keys(value)) {
        if (value[key] !== undefined) {
            result[key] = value[key];
        }
    }
    return result;
}
function normalizeMethod(method) {
    return method.toUpperCase();
}
function normalizePath(path) {
    return path.startsWith('/') ? path : `/${path}`;
}
function normalizeHeaders(headers = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers))
        normalized[key.toLowerCase()] = value;
    return normalized;
}
function routeKey(method, path) {
    return `${normalizeMethod(method)} ${normalizePath(path)}`;
}
function pathSegments(path) {
    return normalizePath(path)
        .split('/')
        .filter((segment) => segment.length > 0);
}
function matchSegments(routeSegments, requestSegments) {
    const params = {};
    for (let index = 0; index < routeSegments.length; index += 1) {
        const routeSegment = routeSegments[index];
        const requestSegment = requestSegments[index];
        if (routeSegment === '*') {
            params['*'] = requestSegments.slice(index).join('/');
            return params;
        }
        if (requestSegment === undefined)
            return undefined;
        if (routeSegment.startsWith(':')) {
            params[routeSegment.slice(1)] = safeDecodeURIComponent(requestSegment);
            continue;
        }
        if (routeSegment !== requestSegment)
            return undefined;
    }
    return routeSegments.length === requestSegments.length ? params : undefined;
}
function parseQuery(searchParams) {
    const query = {};
    for (const [key, value] of searchParams.entries()) {
        const current = query[key];
        if (Array.isArray(current))
            current.push(value);
        else if (current !== undefined)
            query[key] = [current, value];
        else
            query[key] = value;
    }
    return query;
}
function listJobs(jobs, status) {
    return [...jobs.values()]
        .filter((job) => status === undefined || job.status === status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
function normalizeOptionalJobStatus(status) {
    return isJobStatus(status) ? status : undefined;
}
function isJobStatus(status) {
    return (status === 'queued' ||
        status === 'running' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'expired');
}
function inferBodyType(body) {
    if (body === undefined || body === null)
        return 'empty';
    if (typeof body === 'string')
        return 'text';
    return 'json';
}
function estimateBodySize(body, bodyType) {
    if (body === undefined || body === null)
        return 0;
    if (bodyType === 'binary' && typeof body === 'string')
        return Math.ceil((body.length * 3) / 4);
    if (typeof body === 'string')
        return Buffer.byteLength(body);
    try {
        return Buffer.byteLength(JSON.stringify(body));
    }
    catch {
        // A circular reference or a BigInt passed directly to mockRequest() makes
        // JSON.stringify throw synchronously - treat it as exceeding the limit (rather than
        // letting the exception escape and reject the caller's promise) so callers always get
        // a normal RestResponse.
        return Infinity;
    }
}
function createRequest(input) {
    return omitUndefined({ id: randomId(), receivedAt: new Date().toISOString(), ...input });
}
function randomId() {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
/**
 * `decodeURIComponent` throws `URIError` for a malformed escape sequence (e.g. a lone `%`).
 * Falling back to the raw, still-encoded value keeps route matching and job lookups
 * resolving with an ordinary "not found" response instead of rejecting the caller's promise.
 */
function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function normalizeIncomingHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers))
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : (value ?? '');
    return normalized;
}
function discoverUrls(port) {
    const urls = new Set();
    for (const interfaces of Object.values(node_os.networkInterfaces())) {
        for (const networkInterface of interfaces ?? []) {
            if (networkInterface.family === 'IPv4' && !networkInterface.internal)
                urls.add(`http://${networkInterface.address}:${port}`);
        }
    }
    return [...urls].sort();
}
/**
 * Resolves the `Access-Control-Allow-Origin` value for a request, or `undefined` if the
 * request's origin is not allowed (in which case no CORS headers should be sent at all).
 * A comma-joined list of origins is not valid header syntax, so an explicit allowlist is
 * matched against the request's actual `Origin` header instead of being echoed verbatim.
 */
function resolveAllowOrigin(requestOrigin, cors) {
    const origins = cors.origins ?? ['*'];
    if (origins.includes('*')) {
        return cors.allowCredentials && requestOrigin ? requestOrigin : '*';
    }
    if (requestOrigin && origins.includes(requestOrigin)) {
        return requestOrigin;
    }
    return undefined;
}
function withCors(options, requestOrigin, response) {
    if (!options?.cors?.enabled)
        return response;
    const allowOrigin = resolveAllowOrigin(requestOrigin, options.cors);
    if (!allowOrigin)
        return response;
    return {
        ...response,
        headers: {
            ...response.headers,
            'access-control-allow-origin': allowOrigin,
            'access-control-allow-methods': options.cors.methods?.join(',') ?? 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            'access-control-allow-headers': options.cors.headers?.join(',') ?? 'authorization,content-type',
            'access-control-max-age': String(options.cors.maxAgeSeconds ?? 600),
            vary: 'Origin',
            ...(options.cors.exposeHeaders?.length
                ? { 'access-control-expose-headers': options.cors.exposeHeaders.join(',') }
                : {}),
            ...(options.cors.allowCredentials ? { 'access-control-allow-credentials': 'true' } : {}),
        },
    };
}
// A random per-process key normalizes both operands to a fixed-length HMAC digest before
// comparison, so `timingSafeEqual` (which requires equal-length buffers) doesn't leak the
// bearer token's length and mismatches can't be detected by input length alone.
const timingSafeEqualKey = node_crypto.randomBytes(32);
function timingSafeEqualString(a, b) {
    const digestA = node_crypto.createHmac('sha256', timingSafeEqualKey).update(a).digest();
    const digestB = node_crypto.createHmac('sha256', timingSafeEqualKey).update(b).digest();
    return node_crypto.timingSafeEqual(digestA, digestB);
}
async function readRequestBody(request, maxBodySizeBytes) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBodySizeBytes)
            throw new BodyTooLargeError(maxBodySizeBytes);
        chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    if (body.length === 0)
        return { bodyType: 'empty' };
    const contentType = String(request.headers['content-type'] ?? '');
    if (contentType.includes('application/json')) {
        const text = body.toString('utf8');
        return { bodyType: 'json', body: safeJsonParse(text) };
    }
    if (contentType.startsWith('text/'))
        return { bodyType: 'text', body: body.toString('utf8') };
    if (contentType.includes('application/x-www-form-urlencoded'))
        return { bodyType: 'form', body: body.toString('utf8') };
    if (contentType.includes('multipart/form-data'))
        return { bodyType: 'multipart', body: body.toString('utf8') };
    return { bodyType: 'binary', body: body.toString('base64') };
}
function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function writeResponse(response, restResponse) {
    response.statusCode = restResponse.status;
    for (const [key, value] of Object.entries(restResponse.headers ?? {})) {
        // Node computes the real Content-Length from the body; a handler-supplied value could
        // disagree with it (Android drops it as well).
        if (key.toLowerCase() === 'content-length')
            continue;
        response.setHeader(key, value);
    }
    if (restResponse.bodyType === 'empty' || restResponse.body === undefined || restResponse.body === null) {
        response.end();
        return;
    }
    if (restResponse.bodyType === 'binary' && typeof restResponse.body === 'string') {
        response.setHeader('content-type', response.getHeader('content-type') ?? 'application/octet-stream');
        response.end(Buffer.from(restResponse.body, 'base64'));
        return;
    }
    if (restResponse.bodyType === 'text' || typeof restResponse.body === 'string') {
        response.setHeader('content-type', response.getHeader('content-type') ?? 'text/plain; charset=utf-8');
        response.end(String(restResponse.body));
        return;
    }
    response.setHeader('content-type', response.getHeader('content-type') ?? 'application/json; charset=utf-8');
    response.end(JSON.stringify(restResponse.body));
}

function matchRoute(routes, method, path) {
    const requestSegments = pathSegments(path);
    for (const route of routes.values()) {
        if (route.method !== method)
            continue;
        const params = matchSegments(route.segments, requestSegments);
        if (params)
            return { route, params };
    }
    return undefined;
}
function requireJob(jobs, jobId) {
    const job = jobs.get(jobId);
    if (!job)
        throw new Error(`Job ${jobId} was not found`);
    return job;
}
/** Like requireJob(), but also rejects jobs that already reached a terminal state. */
function requireOpenJob(jobs, jobId) {
    const job = requireJob(jobs, jobId);
    if (job.status !== 'queued' && job.status !== 'running') {
        throw new Error(`Job ${jobId} is already ${job.status}`);
    }
    return job;
}
function authorize(auth, headers) {
    if (auth?.type !== 'bearer')
        return undefined;
    // Real HTTP traffic is already lowercased by normalizeIncomingHeaders() before it reaches
    // here, but mockRequest() can be called directly with headers in any casing (e.g.
    // "AUTHORIZATION"), so this needs to normalize too rather than only checking two literal
    // spellings.
    const authorization = normalizeHeaders(headers).authorization ?? '';
    return timingSafeEqualString(authorization, `Bearer ${auth.token}`)
        ? undefined
        : { status: 401, bodyType: 'json', body: { error: 'Unauthorized' } };
}
function trySystemRoute(jobs, method, path, searchParams) {
    if (path === '/__jobs') {
        if (method !== 'GET')
            return { status: 405, bodyType: 'json', body: { error: 'Method not allowed' } };
        return {
            status: 200,
            bodyType: 'json',
            body: { jobs: listJobs(jobs, normalizeOptionalJobStatus(searchParams.get('status'))) },
        };
    }
    const match = path.match(/^\/__jobs\/([^/]+)$/);
    if (!match)
        return undefined;
    const jobId = safeDecodeURIComponent(match[1]);
    if (method === 'GET') {
        const job = jobs.get(jobId);
        return job
            ? { status: 200, bodyType: 'json', body: job }
            : { status: 404, bodyType: 'json', body: { error: 'Job not found' } };
    }
    if (method === 'DELETE') {
        jobs.delete(jobId);
        return { status: 204, bodyType: 'empty' };
    }
    return { status: 405, bodyType: 'json', body: { error: 'Method not allowed' } };
}

class CapacitorREST {
    constructor() {
        // Listener counts are tracked per WebContents: with several windows each one registers its
        // own listeners, and a renderer reload (which does not destroy the WebContents) drops all of
        // its JS listeners without sending any `event-remove-*` message.
        this.listeners = new Map();
        this.routes = new Map();
        this.pending = new Map();
        this.jobs = new Map();
        electron.ipcMain.on('event-add-CapacitorREST', (event, type) => {
            const counts = this.attachWebContents(event.sender);
            const eventType = String(type);
            counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
        });
        for (const eventName of ['request', 'started', 'stopped', 'error', 'jobUpdated']) {
            electron.ipcMain.on(`event-remove-CapacitorREST-${eventName}`, (event) => {
                const counts = this.listeners.get(event.sender);
                if (!counts)
                    return;
                counts.set(eventName, Math.max(0, (counts.get(eventName) ?? 1) - 1));
            });
        }
    }
    async start(options) {
        const authType = options.auth?.type;
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
        const server = node_http.createServer((request, response) => {
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
                writeResponse(response, withCors(this.options, request.headers.origin, {
                    status: error instanceof BodyTooLargeError ? 413 : 500,
                    bodyType: 'json',
                    body: { error: error instanceof Error ? error.message : String(error) },
                }));
            });
        });
        await new Promise((resolve, reject) => {
            const onListenError = (error) => reject(error);
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
    async stop() {
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
            const closed = new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
            server.closeIdleConnections();
            const force = setTimeout(() => server.closeAllConnections(), STOP_GRACE_MS);
            try {
                await closed;
            }
            finally {
                clearTimeout(force);
            }
        }
        this.emit('stopped', { info: await this.getInfo() });
    }
    getPluginPlatform() {
        return 'electron';
    }
    async getInfo() {
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
    async registerRoute(options) {
        const route = normalizeRoute(options);
        this.routes.set(routeKey(route.method, route.path), {
            ...route,
            segments: pathSegments(route.path),
        });
        return route;
    }
    async unregisterRoute(options) {
        this.routes.delete(routeKey(options.method, options.path));
    }
    async clearRoutes() {
        this.routes.clear();
    }
    async respond(options) {
        const pending = this.pending.get(options.requestId);
        if (!pending) {
            throw new Error(`Request ${options.requestId} is not pending`);
        }
        // Normalize first: if the response is malformed this throws while the request is still
        // pending, so the caller can retry and the request is not left hanging with no timer.
        let response;
        try {
            response = normalizeResponse(options);
        }
        catch (error) {
            throw new Error(`Invalid response for request ${options.requestId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        clearTimeout(pending.timeout);
        this.pending.delete(options.requestId);
        pending.resolve(response);
    }
    async completeJob(options) {
        const job = requireOpenJob(this.jobs, options.jobId);
        const updated = {
            ...job,
            status: 'completed',
            response: normalizeResponse(options.response),
            updatedAt: new Date().toISOString(),
        };
        this.jobs.set(options.jobId, updated);
        this.enforceJobRetentionCap();
        this.emit('jobUpdated', { job: updated });
        return updated;
    }
    async failJob(options) {
        const job = requireOpenJob(this.jobs, options.jobId);
        if (options.status !== undefined && options.status !== 'failed' && options.status !== 'cancelled') {
            throw new Error("status must be 'failed' or 'cancelled'");
        }
        const updated = {
            ...job,
            status: options.status ?? 'failed',
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
    enforceJobRetentionCap() {
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
    async getJob(options) {
        return requireJob(this.jobs, options.jobId);
    }
    async listJobs(options = {}) {
        return { jobs: listJobs(this.jobs, options.status) };
    }
    async deleteJob(options) {
        this.jobs.delete(options.jobId);
    }
    async mockRequest(options) {
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
        if (authResponse)
            return withCors(this.options, requestOrigin, authResponse);
        const systemResponse = trySystemRoute(this.jobs, method, url.pathname, url.searchParams);
        if (systemResponse)
            return withCors(this.options, requestOrigin, systemResponse);
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
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(request.id);
                reject(new Error(`Request ${request.id} timed out`));
            }, timeoutMs);
            this.pending.set(request.id, { resolve, reject, timeout });
        });
        this.emit('request', request);
        try {
            return withCors(this.options, requestOrigin, await responsePromise);
        }
        catch (error) {
            return withCors(this.options, requestOrigin, {
                status: error instanceof ServerStoppedError ? 503 : 504,
                bodyType: 'json',
                body: { error: error instanceof Error ? error.message : String(error) },
            });
        }
    }
    attachWebContents(webContents) {
        const existing = this.listeners.get(webContents);
        if (existing)
            return existing;
        const counts = new Map();
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
    emit(eventName, payload) {
        for (const [webContents, counts] of this.listeners) {
            if ((counts.get(eventName) ?? 0) <= 0)
                continue;
            if (webContents.isDestroyed())
                continue;
            webContents.send(`event-CapacitorREST-${eventName}`, payload);
        }
    }
    async handleHttpRequest(request, response) {
        if (request.method === 'OPTIONS') {
            writeResponse(response, withCors(this.options, request.headers.origin, { status: 204, bodyType: 'empty' }));
            return;
        }
        const body = await readRequestBody(request, this.options?.maxBodySizeBytes ?? DEFAULT_MAX_BODY_SIZE_BYTES);
        const restResponse = await this.mockRequest({
            method: (request.method ?? 'GET').toUpperCase(),
            path: request.url ?? '/',
            headers: normalizeIncomingHeaders(request.headers),
            body: body.body,
            bodyType: body.bodyType,
            remoteAddress: request.socket.remoteAddress,
        });
        writeResponse(response, restResponse);
    }
    createJob(request) {
        const now = new Date().toISOString();
        const jobId = randomId();
        const job = {
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
                const updated = { ...current, status: 'expired', updatedAt: new Date().toISOString() };
                this.jobs.set(jobId, updated);
                this.enforceJobRetentionCap();
                this.emit('jobUpdated', { job: updated });
            }
        }, this.options?.jobRetentionMs ?? DEFAULT_JOB_RETENTION_MS);
        expiryTimer.unref();
        return job;
    }
}

exports.CapacitorREST = CapacitorREST;
//# sourceMappingURL=plugin.cjs.js.map
