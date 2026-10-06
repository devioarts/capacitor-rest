import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';

import { BodyTooLargeError } from './types';
import type {
  BodyType,
  CorsOptions,
  JobInfo,
  JobStatus,
  RestMethod,
  RestRequest,
  RestResponse,
  RouteInfo,
  RouteOptions,
  StartOptions,
} from './types';

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

/**
 * Removes properties whose value is `undefined` so objects returned to callers have the same
 * key set on every platform (matches the Web mock's `omitUndefined`, see src/web.ts).
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

export function normalizeMethod(method: string): RestMethod {
  return method.toUpperCase() as RestMethod;
}

export function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
  return normalized;
}

export function routeKey(method: string, path: string): string {
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
    if (requestSegment === undefined) return undefined;
    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = safeDecodeURIComponent(requestSegment);
      continue;
    }
    if (routeSegment !== requestSegment) return undefined;
  }
  return routeSegments.length === requestSegments.length ? params : undefined;
}

export function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = query[key];
    if (Array.isArray(current)) current.push(value);
    else if (current !== undefined) query[key] = [current, value];
    else query[key] = value;
  }
  return query;
}

export function listJobs(jobs: Map<string, JobInfo>, status?: JobStatus): JobInfo[] {
  return [...jobs.values()]
    .filter((job) => status === undefined || job.status === status)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function normalizeOptionalJobStatus(status: string | null): JobStatus | undefined {
  return isJobStatus(status) ? status : undefined;
}

export function isJobStatus(status: unknown): status is JobStatus {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'expired'
  );
}

export function inferBodyType(body: unknown): BodyType {
  if (body === undefined || body === null) return 'empty';
  if (typeof body === 'string') return 'text';
  return 'json';
}

export function estimateBodySize(body: unknown, bodyType?: BodyType): number {
  if (body === undefined || body === null) return 0;
  if (bodyType === 'binary' && typeof body === 'string') return Math.ceil((body.length * 3) / 4);
  if (typeof body === 'string') return Buffer.byteLength(body);
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    // A circular reference or a BigInt passed directly to mockRequest() makes
    // JSON.stringify throw synchronously - treat it as exceeding the limit (rather than
    // letting the exception escape and reject the caller's promise) so callers always get
    // a normal RestResponse.
    return Infinity;
  }
}

export function createRequest(input: Omit<RestRequest, 'id' | 'receivedAt'>): RestRequest {
  return omitUndefined({ id: randomId(), receivedAt: new Date().toISOString(), ...input });
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

export function normalizeIncomingHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers))
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : (value ?? '');
  return normalized;
}

export function discoverUrls(port: number): string[] {
  const urls = new Set<string>();
  for (const interfaces of Object.values(networkInterfaces())) {
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

export function withCors(
  options: StartOptions | undefined,
  requestOrigin: string | undefined,
  response: RestResponse,
): RestResponse {
  if (!options?.cors?.enabled) return response;
  const allowOrigin = resolveAllowOrigin(requestOrigin, options.cors);
  if (!allowOrigin) return response;
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
const timingSafeEqualKey = randomBytes(32);

export function timingSafeEqualString(a: string, b: string): boolean {
  const digestA = createHmac('sha256', timingSafeEqualKey).update(a).digest();
  const digestB = createHmac('sha256', timingSafeEqualKey).update(b).digest();
  return nodeTimingSafeEqual(digestA, digestB);
}

export async function readRequestBody(
  request: IncomingMessage,
  maxBodySizeBytes: number,
): Promise<{ body?: unknown; bodyType: BodyType }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodySizeBytes) throw new BodyTooLargeError(maxBodySizeBytes);
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  if (body.length === 0) return { bodyType: 'empty' };

  const contentType = String(request.headers['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    const text = body.toString('utf8');
    return { bodyType: 'json', body: safeJsonParse(text) };
  }
  if (contentType.startsWith('text/')) return { bodyType: 'text', body: body.toString('utf8') };
  if (contentType.includes('application/x-www-form-urlencoded'))
    return { bodyType: 'form', body: body.toString('utf8') };
  if (contentType.includes('multipart/form-data')) return { bodyType: 'multipart', body: body.toString('utf8') };
  return { bodyType: 'binary', body: body.toString('base64') };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function writeResponse(response: ServerResponse, restResponse: RestResponse): void {
  response.statusCode = restResponse.status;
  for (const [key, value] of Object.entries(restResponse.headers ?? {})) {
    // Node computes the real Content-Length from the body; a handler-supplied value could
    // disagree with it (Android drops it as well).
    if (key.toLowerCase() === 'content-length') continue;
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
