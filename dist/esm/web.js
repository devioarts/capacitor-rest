import { WebPlugin } from '@capacitor/core';
import { DEFAULT_HOST, DEFAULT_JOB_RETENTION_MS, DEFAULT_MAX_BODY_SIZE_BYTES, DEFAULT_MAX_RETAINED_JOBS, DEFAULT_TIMEOUT_MS, ServerStoppedError, createRequest, estimateBodySize, inferBodyType, listJobs as listJobsOf, normalizeHeaders, normalizeMethod, normalizeRoute, normalizeResponse, parseQuery, pathSegments, randomId, routeKey, } from './web-helpers';
import { authorize, enforceJobRetentionCap, matchRoute, requireJob, trySystemRoute, withCors, } from './web-request-handling';
export class CapacitorRESTWeb extends WebPlugin {
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
        return { jobs: listJobsOf(this.jobs, options.status) };
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
//# sourceMappingURL=web.js.map