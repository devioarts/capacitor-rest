import type {
  BodyType,
  CorsOptions,
  JobInfo,
  RestMethod,
  RestRequest,
  RestResponse,
  RouteInfo,
  RouteOptions,
} from './definitions';

export interface RouteRecord extends RouteInfo {
  segments: string[];
}

export interface PendingRequest {
  resolve: (response: RestResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_JOB_RETENTION_MS = 300_000;
export const DEFAULT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_RETAINED_JOBS = 1000;

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobInfo['status']> = new Set([
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

export function normalizeRoute(options: RouteOptions): RouteInfo {
  return omitUndefined({
    method: normalizeMethod(options.method),
    path: normalizePath(options.path),
    mode: options.mode ?? 'sync',
    timeoutMs: options.timeoutMs,
  });
}

export function normalizeResponse(response: RestResponse): RestResponse {
  return omitUndefined({
    status: response.status,
    headers: normalizeHeaders(response.headers),
    body: response.body,
    bodyType: response.bodyType ?? inferBodyType(response.body),
  });
}

export function normalizeMethod(method: RestMethod): RestMethod {
  return method.toUpperCase() as RestMethod;
}

export function normalizePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

export function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

export function routeKey(method: RestMethod, path: string): string {
  return `${normalizeMethod(method)} ${normalizePath(path)}`;
}

export function pathSegments(path: string): string[] {
  return normalizePath(path)
    .split('/')
    .filter((segment) => segment.length > 0);
}

export function matchSegments(routeSegments: string[], requestSegments: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};

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

export function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = query[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (current !== undefined) {
      query[key] = [current, value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

export function listJobs(jobs: Map<string, JobInfo>, status?: JobInfo['status']): JobInfo[] {
  return [...jobs.values()]
    .filter((job) => status === undefined || job.status === status)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function inferBodyType(body: unknown): BodyType {
  if (body === undefined || body === null) {
    return 'empty';
  }
  if (typeof body === 'string') {
    return 'text';
  }
  return 'json';
}

export function normalizeOptionalJobStatus(status: string | null): JobInfo['status'] | undefined {
  return isJobStatus(status) ? status : undefined;
}

export function isJobStatus(status: unknown): status is JobInfo['status'] {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'expired'
  );
}

export function estimateBodySize(body: unknown, bodyType?: BodyType): number {
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
  } catch {
    // A circular reference or a BigInt passed directly to mockRequest() makes
    // JSON.stringify throw synchronously - treat it as exceeding the limit (rather than
    // letting the exception escape and reject the caller's promise) so callers always get
    // a normal RestResponse.
    return Infinity;
  }
}

export function createRequest(input: Omit<RestRequest, 'id' | 'receivedAt'>): RestRequest {
  return omitUndefined({
    id: randomId(),
    receivedAt: new Date().toISOString(),
    ...input,
  });
}

export function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

/**
 * `decodeURIComponent` throws `URIError` for a malformed escape sequence (e.g. a lone `%`).
 * Falling back to the raw, still-encoded value keeps route matching and job lookups
 * resolving with an ordinary "not found" response instead of rejecting the caller's promise.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Removes properties whose value is `undefined` so objects returned to callers have the same
 * key set on every platform. Android/iOS/Electron build their response objects through a
 * bridge that drops `undefined`-valued keys; plain JS object literals in this file do not,
 * so `Object.keys()`/`in` checks would otherwise disagree with the native platforms.
 */
export function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const result = {} as T;
  for (const key of Object.keys(value) as Array<keyof T>) {
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
export function resolveAllowOrigin(requestOrigin: string | undefined, cors: CorsOptions): string | undefined {
  const origins = cors.origins ?? ['*'];
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
export function timingSafeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < maxLength; index += 1) {
    const codeA = index < a.length ? a.charCodeAt(index) : 0;
    const codeB = index < b.length ? b.charCodeAt(index) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}
