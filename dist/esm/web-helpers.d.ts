import type { BodyType, CorsOptions, JobInfo, RestMethod, RestRequest, RestResponse, RouteInfo, RouteOptions } from './definitions';
export interface RouteRecord extends RouteInfo {
    segments: string[];
}
export interface PendingRequest {
    resolve: (response: RestResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}
export declare const DEFAULT_HOST = "0.0.0.0";
export declare const DEFAULT_TIMEOUT_MS = 30000;
export declare const DEFAULT_JOB_RETENTION_MS = 300000;
export declare const DEFAULT_MAX_BODY_SIZE_BYTES: number;
export declare const DEFAULT_MAX_RETAINED_JOBS = 1000;
export declare const TERMINAL_JOB_STATUSES: ReadonlySet<JobInfo['status']>;
/**
 * Distinguishes an explicit `stop()` call from a genuine request timeout so a pending
 * synchronous request can resolve with `503` (stopped) instead of `504` (timed out).
 */
export declare class ServerStoppedError extends Error {
    constructor();
}
export declare function normalizeRoute(options: RouteOptions): RouteInfo;
export declare function normalizeResponse(response: RestResponse): RestResponse;
export declare function normalizeMethod(method: RestMethod): RestMethod;
export declare function normalizePath(path: string): string;
export declare function normalizeHeaders(headers?: Record<string, string>): Record<string, string>;
export declare function routeKey(method: RestMethod, path: string): string;
export declare function pathSegments(path: string): string[];
export declare function matchSegments(routeSegments: string[], requestSegments: string[]): Record<string, string> | undefined;
export declare function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]>;
export declare function listJobs(jobs: Map<string, JobInfo>, status?: JobInfo['status']): JobInfo[];
export declare function inferBodyType(body: unknown): BodyType;
export declare function normalizeOptionalJobStatus(status: string | null): JobInfo['status'] | undefined;
export declare function isJobStatus(status: unknown): status is JobInfo['status'];
export declare function estimateBodySize(body: unknown, bodyType?: BodyType): number;
export declare function createRequest(input: Omit<RestRequest, 'id' | 'receivedAt'>): RestRequest;
export declare function randomId(): string;
/**
 * `decodeURIComponent` throws `URIError` for a malformed escape sequence (e.g. a lone `%`).
 * Falling back to the raw, still-encoded value keeps route matching and job lookups
 * resolving with an ordinary "not found" response instead of rejecting the caller's promise.
 */
export declare function safeDecodeURIComponent(value: string): string;
/**
 * Removes properties whose value is `undefined` so objects returned to callers have the same
 * key set on every platform. Android/iOS/Electron build their response objects through a
 * bridge that drops `undefined`-valued keys; plain JS object literals in this file do not,
 * so `Object.keys()`/`in` checks would otherwise disagree with the native platforms.
 */
export declare function omitUndefined<T extends Record<string, unknown>>(value: T): T;
/**
 * Resolves the `Access-Control-Allow-Origin` value for a request, or `undefined` if the
 * request's origin is not allowed (in which case no CORS headers should be sent at all).
 * A comma-joined list of origins is not valid header syntax, so an explicit allowlist is
 * matched against the request's actual `Origin` header instead of being echoed verbatim.
 */
export declare function resolveAllowOrigin(requestOrigin: string | undefined, cors: CorsOptions): string | undefined;
/**
 * Constant-time string comparison so bearer token checks don't leak timing information
 * through JS engine short-circuiting on the first mismatched character.
 */
export declare function timingSafeEqual(a: string, b: string): boolean;
