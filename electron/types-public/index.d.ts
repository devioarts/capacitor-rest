import type {
  CompleteJobOptions,
  FailJobOptions,
  JobIdOptions,
  JobInfo,
  ListJobsOptions,
  ListJobsResult,
  MockRequestOptions,
  PluginPlatform,
  RemoveRouteOptions,
  RestResponse,
  RouteInfo,
  RouteOptions,
  ServerInfo,
  StartOptions,
} from '../../dist/esm/definitions';

export declare class CapacitorREST {
  start(options: StartOptions): Promise<ServerInfo>;
  stop(): Promise<void>;
  getInfo(): Promise<ServerInfo>;
  getPluginPlatform(): PluginPlatform;
  registerRoute(options: RouteOptions): Promise<RouteInfo>;
  unregisterRoute(options: RemoveRouteOptions): Promise<void>;
  clearRoutes(): Promise<void>;
  respond(options: RestResponse & { requestId: string }): Promise<void>;
  completeJob(options: CompleteJobOptions): Promise<JobInfo>;
  failJob(options: FailJobOptions): Promise<JobInfo>;
  getJob(options: JobIdOptions): Promise<JobInfo>;
  listJobs(options?: ListJobsOptions): Promise<ListJobsResult>;
  deleteJob(options: JobIdOptions): Promise<void>;
  mockRequest(options: MockRequestOptions): Promise<RestResponse>;
}
