import { listJobs, matchSegments, normalizeHeaders, normalizeOptionalJobStatus, pathSegments, resolveAllowOrigin, safeDecodeURIComponent, timingSafeEqual, } from './web-helpers';
export function matchRoute(routes, method, path) {
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
/** Like requireJob(), but also rejects jobs that already reached a terminal state. */
export function requireOpenJob(jobs, jobId) {
    const job = requireJob(jobs, jobId);
    if (job.status !== 'queued' && job.status !== 'running') {
        throw new Error(`Job ${jobId} is already ${job.status}`);
    }
    return job;
}
export function requireJob(jobs, jobId) {
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
export function enforceJobRetentionCap(jobs, maxRetainedJobs) {
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
export function authorize(auth, headers) {
    var _a;
    if ((auth === null || auth === void 0 ? void 0 : auth.type) !== 'bearer') {
        return undefined;
    }
    const normalized = normalizeHeaders(headers);
    return timingSafeEqual((_a = normalized.authorization) !== null && _a !== void 0 ? _a : '', `Bearer ${auth.token}`)
        ? undefined
        : { status: 401, bodyType: 'json', body: { error: 'Unauthorized' } };
}
export function withCors(cors, response, requestOrigin) {
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
export function trySystemRoute(jobs, method, path, searchParams) {
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
//# sourceMappingURL=web-request-handling.js.map