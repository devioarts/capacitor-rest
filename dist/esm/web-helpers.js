export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_JOB_RETENTION_MS = 300000;
export const DEFAULT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_RETAINED_JOBS = 1000;
export const TERMINAL_JOB_STATUSES = new Set([
    'completed',
    'failed',
    'cancelled',
    'expired',
]);
/**
 * Distinguishes an explicit `stop()` call from a genuine request timeout so a pending
 * synchronous request can resolve with `503` (stopped) instead of `504` (timed out).
 */
export class ServerStoppedError extends Error {
    constructor() {
        super('Server stopped');
    }
}
export function normalizeRoute(options) {
    var _a;
    return omitUndefined({
        method: normalizeMethod(options.method),
        path: normalizePath(options.path),
        mode: (_a = options.mode) !== null && _a !== void 0 ? _a : 'sync',
        timeoutMs: options.timeoutMs,
    });
}
export function normalizeResponse(response) {
    var _a;
    return omitUndefined({
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: response.body,
        bodyType: (_a = response.bodyType) !== null && _a !== void 0 ? _a : inferBodyType(response.body),
    });
}
export function normalizeMethod(method) {
    return method.toUpperCase();
}
export function normalizePath(path) {
    if (!path.startsWith('/')) {
        return `/${path}`;
    }
    return path;
}
export function normalizeHeaders(headers = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
    }
    return normalized;
}
export function routeKey(method, path) {
    return `${normalizeMethod(method)} ${normalizePath(path)}`;
}
export function pathSegments(path) {
    return normalizePath(path)
        .split('/')
        .filter((segment) => segment.length > 0);
}
export function matchSegments(routeSegments, requestSegments) {
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
export function parseQuery(searchParams) {
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
export function listJobs(jobs, status) {
    return [...jobs.values()]
        .filter((job) => status === undefined || job.status === status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
export function inferBodyType(body) {
    if (body === undefined || body === null) {
        return 'empty';
    }
    if (typeof body === 'string') {
        return 'text';
    }
    return 'json';
}
export function normalizeOptionalJobStatus(status) {
    return isJobStatus(status) ? status : undefined;
}
export function isJobStatus(status) {
    return (status === 'queued' ||
        status === 'running' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'expired');
}
export function estimateBodySize(body, bodyType) {
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
export function createRequest(input) {
    return omitUndefined(Object.assign({ id: randomId(), receivedAt: new Date().toISOString() }, input));
}
export function randomId() {
    var _a, _b;
    var _c;
    return (_c = (_b = (_a = globalThis.crypto) === null || _a === void 0 ? void 0 : _a.randomUUID) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : Math.random().toString(36).slice(2);
}
/**
 * `decodeURIComponent` throws `URIError` for a malformed escape sequence (e.g. a lone `%`).
 * Falling back to the raw, still-encoded value keeps route matching and job lookups
 * resolving with an ordinary "not found" response instead of rejecting the caller's promise.
 */
export function safeDecodeURIComponent(value) {
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
export function omitUndefined(value) {
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
export function resolveAllowOrigin(requestOrigin, cors) {
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
export function timingSafeEqual(a, b) {
    const maxLength = Math.max(a.length, b.length);
    let diff = a.length === b.length ? 0 : 1;
    for (let index = 0; index < maxLength; index += 1) {
        const codeA = index < a.length ? a.charCodeAt(index) : 0;
        const codeB = index < b.length ? b.charCodeAt(index) : 0;
        diff |= codeA ^ codeB;
    }
    return diff === 0;
}
//# sourceMappingURL=web-helpers.js.map