import {
  listJobs,
  matchSegments,
  normalizeHeaders,
  normalizeOptionalJobStatus,
  pathSegments,
  safeDecodeURIComponent,
  timingSafeEqualString,
} from './helpers';
import type { AuthOptions, JobInfo, RestMethod, RestResponse, RouteRecord } from './types';

export function matchRoute(
  routes: Map<string, RouteRecord>,
  method: RestMethod,
  path: string,
): { route: RouteRecord; params: Record<string, string> } | undefined {
  const requestSegments = pathSegments(path);
  for (const route of routes.values()) {
    if (route.method !== method) continue;
    const params = matchSegments(route.segments, requestSegments);
    if (params) return { route, params };
  }
  return undefined;
}

export function requireJob(jobs: Map<string, JobInfo>, jobId: string): JobInfo {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found`);
  return job;
}

export function authorize(auth: AuthOptions | undefined, headers: Record<string, string>): RestResponse | undefined {
  if (auth?.type !== 'bearer') return undefined;
  // Real HTTP traffic is already lowercased by normalizeIncomingHeaders() before it reaches
  // here, but mockRequest() can be called directly with headers in any casing (e.g.
  // "AUTHORIZATION"), so this needs to normalize too rather than only checking two literal
  // spellings.
  const authorization = normalizeHeaders(headers).authorization ?? '';
  return timingSafeEqualString(authorization, `Bearer ${auth.token}`)
    ? undefined
    : { status: 401, bodyType: 'json', body: { error: 'Unauthorized' } };
}

export function trySystemRoute(
  jobs: Map<string, JobInfo>,
  method: RestMethod,
  path: string,
  searchParams: URLSearchParams,
): RestResponse | undefined {
  if (path === '/__jobs') {
    if (method !== 'GET') return { status: 405, bodyType: 'json', body: { error: 'Method not allowed' } };
    return {
      status: 200,
      bodyType: 'json',
      body: { jobs: listJobs(jobs, normalizeOptionalJobStatus(searchParams.get('status'))) },
    };
  }

  const match = path.match(/^\/__jobs\/([^/]+)$/);
  if (!match) return undefined;
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
