import type { AuthOptions, CorsOptions, JobInfo, RestMethod, RestResponse } from './definitions';
import type { RouteRecord } from './web-helpers';
export declare function matchRoute(routes: Map<string, RouteRecord>, method: RestMethod, path: string): {
    route: RouteRecord;
    params: Record<string, string>;
} | undefined;
/** Like requireJob(), but also rejects jobs that already reached a terminal state. */
export declare function requireOpenJob(jobs: Map<string, JobInfo>, jobId: string): JobInfo;
export declare function requireJob(jobs: Map<string, JobInfo>, jobId: string): JobInfo;
/**
 * Evicts the oldest terminal-state jobs (never `queued`/`running`) once the retained job
 * count exceeds `maxRetainedJobs`, so a client that never calls `deleteJob()` can't grow
 * the job map - and the full request/response bodies it holds - without bound.
 */
export declare function enforceJobRetentionCap(jobs: Map<string, JobInfo>, maxRetainedJobs: number): void;
export declare function authorize(auth: AuthOptions | undefined, headers: Record<string, string>): RestResponse | undefined;
export declare function withCors(cors: CorsOptions | undefined, response: RestResponse, requestOrigin?: string): RestResponse;
export declare function trySystemRoute(jobs: Map<string, JobInfo>, method: RestMethod, path: string, searchParams: URLSearchParams): RestResponse | undefined;
