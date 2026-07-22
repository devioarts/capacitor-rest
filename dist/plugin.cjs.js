'use strict';

var core = require('@capacitor/core');

function getPluginPlatform() {
    return core.Capacitor.getPlatform();
}
const CapacitorRESTBridge = core.registerPlugin('CapacitorREST', {
    web: () => Promise.resolve().then(function () { return web; }).then((m) => new m.CapacitorRESTWeb()),
});
const CapacitorREST = {
    start: (options) => CapacitorRESTBridge.start(options),
    stop: () => CapacitorRESTBridge.stop(),
    getInfo: () => CapacitorRESTBridge.getInfo(),
    getPluginPlatform,
    registerRoute: (options) => CapacitorRESTBridge.registerRoute(options),
    unregisterRoute: (options) => CapacitorRESTBridge.unregisterRoute(options),
    clearRoutes: () => CapacitorRESTBridge.clearRoutes(),
    respond: (options) => CapacitorRESTBridge.respond(options),
    completeJob: (options) => CapacitorRESTBridge.completeJob(options),
    failJob: (options) => CapacitorRESTBridge.failJob(options),
    getJob: (options) => CapacitorRESTBridge.getJob(options),
    listJobs: (options) => CapacitorRESTBridge.listJobs(options),
    deleteJob: (options) => CapacitorRESTBridge.deleteJob(options),
    mockRequest: (options) => CapacitorRESTBridge.mockRequest(options),
    addListener: CapacitorRESTBridge.addListener.bind(CapacitorRESTBridge),
};
async function handleRequests(handler) {
    return CapacitorREST.addListener('request', async (request) => {
        try {
            const response = await handler(request);
            if (request.jobId) {
                const { jobId } = request;
                await settleRequest(() => CapacitorREST.completeJob({
                    jobId,
                    response,
                }));
                return;
            }
            await settleRequest(() => CapacitorREST.respond(Object.assign({ requestId: request.id }, response)));
        }
        catch (error) {
            if (request.jobId) {
                const { jobId } = request;
                await settleRequest(() => CapacitorREST.failJob({
                    jobId,
                    error: error instanceof Error ? error.message : String(error),
                }));
                return;
            }
            await settleRequest(() => CapacitorREST.respond({
                requestId: request.id,
                status: 500,
                bodyType: 'json',
                body: {
                    error: error instanceof Error ? error.message : String(error),
                },
            }));
        }
    });
}
async function settleRequest(action) {
    try {
        await action();
    }
    catch (_a) {
        // A sync HTTP request may already have timed out, or an async job may have
        // been deleted before the JavaScript handler settles. The HTTP side has
        // already returned the appropriate terminal response in that case.
    }
}

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_JOB_RETENTION_MS = 300000;
const DEFAULT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_JOBS = 1000;
/**
 * Distinguishes an explicit `stop()` call from a genuine request timeout so a pending
 * synchronous request can resolve with `503` (stopped) instead of `504` (timed out).
 */
class ServerStoppedError extends Error {
    constructor() {
        super('Server stopped');
    }
}
function normalizeRoute(options) {
    var _a;
    return omitUndefined({
        method: normalizeMethod(options.method),
        path: normalizePath(options.path),
        mode: (_a = options.mode) !== null && _a !== void 0 ? _a : 'sync',
        timeoutMs: options.timeoutMs,
    });
}
function normalizeResponse(response) {
    var _a;
    return omitUndefined({
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: response.body,
        bodyType: (_a = response.bodyType) !== null && _a !== void 0 ? _a : inferBodyType(response.body),
    });
}
function normalizeMethod(method) {
    return method.toUpperCase();
}
function normalizePath(path) {
    if (!path.startsWith('/')) {
        return `/${path}`;
    }
    return path;
}
function normalizeHeaders(headers = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
    }
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
        if (requestSegment === undefined) {
            return undefined;
        }
        if (routeSegment.startsWith(':')) {
            params[routeSegment.slice(1)] = safeDecodeURIComponent(requestSegment);
            continue;
        }
        if (routeSegment !== requestSegment) {
            return undefined;
        }
    }
    return routeSegments.length === requestSegments.length ? params : undefined;
}
function parseQuery(searchParams) {
    const query = {};
    for (const [key, value] of searchParams.entries()) {
        const current = query[key];
        if (Array.isArray(current)) {
            current.push(value);
        }
        else if (current !== undefined) {
            query[key] = [current, value];
        }
        else {
            query[key] = value;
        }
    }
    return query;
}
function listJobs(jobs, status) {
    return [...jobs.values()]
        .filter((job) => status === undefined || job.status === status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
function inferBodyType(body) {
    if (body === undefined || body === null) {
        return 'empty';
    }
    if (typeof body === 'string') {
        return 'text';
    }
    return 'json';
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
function estimateBodySize(body, bodyType) {
    if (body === undefined || body === null) {
        return 0;
    }
    if (bodyType === 'binary' && typeof body === 'string') {
        return Math.ceil((body.length * 3) / 4);
    }
    if (typeof body === 'string') {
        return new TextEncoder().encode(body).length;
    }
    try {
        return new TextEncoder().encode(JSON.stringify(body)).length;
    }
    catch (_a) {
        // A circular reference or a BigInt passed directly to mockRequest() makes
        // JSON.stringify throw synchronously - treat it as exceeding the limit (rather than
        // letting the exception escape and reject the caller's promise) so callers always get
        // a normal RestResponse.
        return Infinity;
    }
}
function createRequest(input) {
    return omitUndefined(Object.assign({ id: randomId(), receivedAt: new Date().toISOString() }, input));
}
function randomId() {
    var _a, _b;
    var _c;
    return (_c = (_b = (_a = globalThis.crypto) === null || _a === void 0 ? void 0 : _a.randomUUID) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : Math.random().toString(36).slice(2);
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
    catch (_a) {
        return value;
    }
}
/**
 * Removes properties whose value is `undefined` so objects returned to callers have the same
 * key set on every platform. Android/iOS/Electron build their response objects through a
 * bridge that drops `undefined`-valued keys; plain JS object literals in this file do not,
 * so `Object.keys()`/`in` checks would otherwise disagree with the native platforms.
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
/**
 * Resolves the `Access-Control-Allow-Origin` value for a request, or `undefined` if the
 * request's origin is not allowed (in which case no CORS headers should be sent at all).
 * A comma-joined list of origins is not valid header syntax, so an explicit allowlist is
 * matched against the request's actual `Origin` header instead of being echoed verbatim.
 */
function resolveAllowOrigin(requestOrigin, cors) {
    var _a;
    const origins = (_a = cors.origins) !== null && _a !== void 0 ? _a : ['*'];
    if (origins.includes('*')) {
        return cors.allowCredentials && requestOrigin ? requestOrigin : '*';
    }
    if (requestOrigin && origins.includes(requestOrigin)) {
        return requestOrigin;
    }
    return undefined;
}
/**
 * Constant-time string comparison so bearer token checks don't leak timing information
 * through JS engine short-circuiting on the first mismatched character.
 */
function timingSafeEqual(a, b) {
    const maxLength = Math.max(a.length, b.length);
    let diff = a.length === b.length ? 0 : 1;
    for (let index = 0; index < maxLength; index += 1) {
        const codeA = index < a.length ? a.charCodeAt(index) : 0;
        const codeB = index < b.length ? b.charCodeAt(index) : 0;
        diff |= codeA ^ codeB;
    }
    return diff === 0;
}

function matchRoute(routes, method, path) {
    const requestSegments = pathSegments(path);
    for (const route of routes.values()) {
        if (route.method !== method) {
            continue;
        }
        const params = matchSegments(route.segments, requestSegments);
        if (params) {
            return { route, params };
        }
    }
    return undefined;
}
function requireJob(jobs, jobId) {
    const job = jobs.get(jobId);
    if (!job) {
        throw new Error(`Job ${jobId} was not found`);
    }
    return job;
}
/**
 * Evicts the oldest terminal-state jobs (never `queued`/`running`) once the retained job
 * count exceeds `maxRetainedJobs`, so a client that never calls `deleteJob()` can't grow
 * the job map - and the full request/response bodies it holds - without bound.
 */
function enforceJobRetentionCap(jobs, maxRetainedJobs) {
    let excess = jobs.size - maxRetainedJobs;
    if (excess <= 0) {
        return;
    }
    const terminalJobs = listJobs(jobs).filter((job) => job.status !== 'queued' && job.status !== 'running');
    for (const job of terminalJobs) {
        if (excess <= 0) {
            break;
        }
        jobs.delete(job.jobId);
        excess -= 1;
    }
}
function authorize(auth, headers) {
    var _a;
    if ((auth === null || auth === void 0 ? void 0 : auth.type) !== 'bearer') {
        return undefined;
    }
    const normalized = normalizeHeaders(headers);
    return timingSafeEqual((_a = normalized.authorization) !== null && _a !== void 0 ? _a : '', `Bearer ${auth.token}`)
        ? undefined
        : { status: 401, bodyType: 'json', body: { error: 'Unauthorized' } };
}
function withCors(cors, response, requestOrigin) {
    var _a, _b, _c;
    var _d, _e, _f;
    if (!(cors === null || cors === void 0 ? void 0 : cors.enabled)) {
        return response;
    }
    const allowOrigin = resolveAllowOrigin(requestOrigin, cors);
    if (!allowOrigin) {
        return response;
    }
    return Object.assign(Object.assign({}, response), { headers: Object.assign(Object.assign(Object.assign(Object.assign({}, response.headers), { 'access-control-allow-origin': allowOrigin, 'access-control-allow-methods': (_d = (_a = cors.methods) === null || _a === void 0 ? void 0 : _a.join(',')) !== null && _d !== void 0 ? _d : 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS', 'access-control-allow-headers': (_e = (_b = cors.headers) === null || _b === void 0 ? void 0 : _b.join(',')) !== null && _e !== void 0 ? _e : 'authorization,content-type', 'access-control-max-age': String((_f = cors.maxAgeSeconds) !== null && _f !== void 0 ? _f : 600), vary: 'Origin' }), (((_c = cors.exposeHeaders) === null || _c === void 0 ? void 0 : _c.length) ? { 'access-control-expose-headers': cors.exposeHeaders.join(',') } : {})), (cors.allowCredentials ? { 'access-control-allow-credentials': 'true' } : {})) });
}
function trySystemRoute(jobs, method, path, searchParams) {
    if (path === '/__jobs') {
        if (method !== 'GET') {
            return { status: 405, bodyType: 'json', body: { error: 'Method not allowed' } };
        }
        return {
            status: 200,
            bodyType: 'json',
            body: { jobs: listJobs(jobs, normalizeOptionalJobStatus(searchParams.get('status'))) },
        };
    }
    const match = path.match(/^\/__jobs\/([^/]+)$/);
    if (!match) {
        return undefined;
    }
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

class CapacitorRESTWeb extends core.WebPlugin {
    constructor() {
        super(...arguments);
        this.routes = new Map();
        this.pending = new Map();
        this.jobs = new Map();
    }
    async start(options) {
        var _a, _b;
        var _c;
        const authType = (_a = options.auth) === null || _a === void 0 ? void 0 : _a.type;
        if (authType && authType !== 'none' && authType !== 'bearer') {
            throw new Error("auth.type must be 'none' or 'bearer'");
        }
        if (((_b = options.auth) === null || _b === void 0 ? void 0 : _b.type) === 'bearer' && !options.auth.token) {
            throw new Error("auth.token is required when auth.type is 'bearer'");
        }
        this.options = Object.assign({ host: (_c = options.host) !== null && _c !== void 0 ? _c : DEFAULT_HOST, requestTimeoutMs: DEFAULT_TIMEOUT_MS, jobRetentionMs: DEFAULT_JOB_RETENTION_MS, maxBodySizeBytes: DEFAULT_MAX_BODY_SIZE_BYTES, maxRetainedJobs: DEFAULT_MAX_RETAINED_JOBS }, options);
        const info = await this.getInfo();
        await this.notifyListeners('started', { info });
        return info;
    }
    async stop() {
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
    async getInfo() {
        var _a;
        var _b;
        return {
            running: this.options !== undefined,
            host: (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.host) !== null && _b !== void 0 ? _b : DEFAULT_HOST,
            port: 0,
            urls: [],
            mock: true,
        };
    }
    getPluginPlatform() {
        return 'web';
    }
    async registerRoute(options) {
        const route = normalizeRoute(options);
        this.routes.set(routeKey(route.method, route.path), Object.assign(Object.assign({}, route), { segments: pathSegments(route.path) }));
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
        clearTimeout(pending.timeout);
        this.pending.delete(options.requestId);
        pending.resolve(normalizeResponse(options));
    }
    async completeJob(options) {
        var _a;
        var _b;
        const job = requireJob(this.jobs, options.jobId);
        const updated = Object.assign(Object.assign({}, job), { status: 'completed', response: normalizeResponse(options.response), updatedAt: new Date().toISOString() });
        this.jobs.set(options.jobId, updated);
        enforceJobRetentionCap(this.jobs, (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.maxRetainedJobs) !== null && _b !== void 0 ? _b : DEFAULT_MAX_RETAINED_JOBS);
        await this.notifyListeners('jobUpdated', { job: updated });
        return updated;
    }
    async failJob(options) {
        var _a;
        var _b, _c;
        const job = requireJob(this.jobs, options.jobId);
        const updated = Object.assign(Object.assign({}, job), { status: (_b = options.status) !== null && _b !== void 0 ? _b : 'failed', error: options.error, updatedAt: new Date().toISOString() });
        this.jobs.set(options.jobId, updated);
        enforceJobRetentionCap(this.jobs, (_c = (_a = this.options) === null || _a === void 0 ? void 0 : _a.maxRetainedJobs) !== null && _c !== void 0 ? _c : DEFAULT_MAX_RETAINED_JOBS);
        await this.notifyListeners('jobUpdated', { job: updated });
        return updated;
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        var _k, _l, _m, _o, _p, _q;
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
            return withCors((_a = this.options) === null || _a === void 0 ? void 0 : _a.cors, {
                status: 204,
                bodyType: 'empty',
            }, requestOrigin);
        }
        if (estimateBodySize(options.body, options.bodyType) > ((_k = this.options.maxBodySizeBytes) !== null && _k !== void 0 ? _k : DEFAULT_MAX_BODY_SIZE_BYTES)) {
            return withCors((_b = this.options) === null || _b === void 0 ? void 0 : _b.cors, {
                status: 413,
                bodyType: 'json',
                body: { error: 'Payload too large' },
            }, requestOrigin);
        }
        const authResponse = authorize((_c = this.options) === null || _c === void 0 ? void 0 : _c.auth, (_l = options.headers) !== null && _l !== void 0 ? _l : {});
        if (authResponse) {
            return withCors((_d = this.options) === null || _d === void 0 ? void 0 : _d.cors, authResponse, requestOrigin);
        }
        const systemResponse = trySystemRoute(this.jobs, method, url.pathname, url.searchParams);
        if (systemResponse) {
            return withCors((_e = this.options) === null || _e === void 0 ? void 0 : _e.cors, systemResponse, requestOrigin);
        }
        const match = matchRoute(this.routes, method, url.pathname);
        if (!match) {
            return withCors((_f = this.options) === null || _f === void 0 ? void 0 : _f.cors, {
                status: 404,
                bodyType: 'json',
                body: { error: 'Route not found' },
            }, requestOrigin);
        }
        const request = createRequest({
            route: match.route.path,
            method,
            path: url.pathname,
            params: match.params,
            query: parseQuery(url.searchParams),
            headers: normalizeHeaders(options.headers),
            body: options.body,
            bodyType: (_m = options.bodyType) !== null && _m !== void 0 ? _m : inferBodyType(options.body),
            remoteAddress: options.remoteAddress,
        });
        if (match.route.mode === 'async') {
            const job = this.createJob(request);
            await this.notifyListeners('request', (_o = job.request) !== null && _o !== void 0 ? _o : request);
            return withCors((_g = this.options) === null || _g === void 0 ? void 0 : _g.cors, {
                status: 202,
                bodyType: 'json',
                headers: { location: `/__jobs/${job.jobId}` },
                body: {
                    jobId: job.jobId,
                    status: job.status,
                    location: `/__jobs/${job.jobId}`,
                },
            }, requestOrigin);
        }
        const timeoutMs = (_q = (_p = match.route.timeoutMs) !== null && _p !== void 0 ? _p : this.options.requestTimeoutMs) !== null && _q !== void 0 ? _q : DEFAULT_TIMEOUT_MS;
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(request.id);
                reject(new Error(`Request ${request.id} timed out`));
            }, timeoutMs);
            this.pending.set(request.id, { resolve, reject, timeout });
        });
        await this.notifyListeners('request', request);
        try {
            return withCors((_h = this.options) === null || _h === void 0 ? void 0 : _h.cors, await responsePromise, requestOrigin);
        }
        catch (error) {
            return withCors((_j = this.options) === null || _j === void 0 ? void 0 : _j.cors, {
                status: error instanceof ServerStoppedError ? 503 : 504,
                bodyType: 'json',
                body: {
                    error: error instanceof Error ? error.message : String(error),
                },
            }, requestOrigin);
        }
    }
    createJob(request) {
        const now = new Date().toISOString();
        const jobId = randomId();
        const jobRequest = Object.assign(Object.assign({}, request), { jobId });
        const job = {
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
    scheduleJobExpiry(jobId) {
        var _a;
        var _b;
        const retentionMs = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.jobRetentionMs) !== null && _b !== void 0 ? _b : DEFAULT_JOB_RETENTION_MS;
        setTimeout(() => {
            var _a;
            var _b;
            const job = this.jobs.get(jobId);
            if (job && job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
                const updated = Object.assign(Object.assign({}, job), { status: 'expired', updatedAt: new Date().toISOString() });
                this.jobs.set(jobId, updated);
                enforceJobRetentionCap(this.jobs, (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.maxRetainedJobs) !== null && _b !== void 0 ? _b : DEFAULT_MAX_RETAINED_JOBS);
                void this.notifyListeners('jobUpdated', { job: updated });
            }
        }, retentionMs);
    }
}

var web = /*#__PURE__*/Object.freeze({
    __proto__: null,
    CapacitorRESTWeb: CapacitorRESTWeb
});

exports.CapacitorREST = CapacitorREST;
exports.getPluginPlatform = getPluginPlatform;
exports.handleRequests = handleRequests;
//# sourceMappingURL=plugin.cjs.js.map
