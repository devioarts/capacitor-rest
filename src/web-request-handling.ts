import type { AuthOptions, CorsOptions, JobInfo, RestMethod, RestResponse } from './definitions';
import {
  listJobs,
  matchSegments,
  normalizeHeaders,
  normalizeOptionalJobStatus,
  pathSegments,
  resolveAllowOrigin,
  safeDecodeURIComponent,
  timingSafeEqual,
} from './web-helpers';
import type { RouteRecord } from './web-helpers';

export function matchRoute(
  routes: Map<string, RouteRecord>,
  method: RestMethod,
  path: string,
): { route: RouteRecord; params: Record<string, string> } | undefined {
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

export function requireJob(jobs: Map<string, JobInfo>, jobId: string): JobInfo {
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
export function enforceJobRetentionCap(jobs: Map<string, JobInfo>, maxRetainedJobs: number): void {
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

export function authorize(auth: AuthOptions | undefined, headers: Record<string, string>): RestResponse | undefined {
  if (auth?.type !== 'bearer') {
    return undefined;
  }
  const normalized = normalizeHeaders(headers);
  return timingSafeEqual(normalized.authorization ?? '', `Bearer ${auth.token}`)
    ? undefined
    : { status: 401, bodyType: 'json', body: { error: 'Unauthorized' } };
}

export function withCors(cors: CorsOptions | undefined, response: RestResponse, requestOrigin?: string): RestResponse {
  if (!cors?.enabled) {
    return response;
  }
  const allowOrigin = resolveAllowOrigin(requestOrigin, cors);
  if (!allowOrigin) {
    return response;
  }
  return {
    ...response,
    headers: {
      ...response.headers,
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': cors.methods?.join(',') ?? 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'access-control-allow-headers': cors.headers?.join(',') ?? 'authorization,content-type',
      'access-control-max-age': String(cors.maxAgeSeconds ?? 600),
      vary: 'Origin',
      ...(cors.exposeHeaders?.length ? { 'access-control-expose-headers': cors.exposeHeaders.join(',') } : {}),
      ...(cors.allowCredentials ? { 'access-control-allow-credentials': 'true' } : {}),
    },
  };
}

export function trySystemRoute(
  jobs: Map<string, JobInfo>,
  method: RestMethod,
  path: string,
  searchParams: URLSearchParams,
): RestResponse | undefined {
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
