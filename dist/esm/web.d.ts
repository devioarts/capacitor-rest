import { WebPlugin } from '@capacitor/core';
import type { CapacitorRESTPlugin, CompleteJobOptions, FailJobOptions, JobIdOptions, JobInfo, ListJobsOptions, ListJobsResult, MockRequestOptions, PluginPlatform, RemoveRouteOptions, RespondOptions, RestResponse, RouteInfo, RouteOptions, ServerInfo, StartOptions } from './definitions';
export declare class CapacitorRESTWeb extends WebPlugin implements CapacitorRESTPlugin {
    private options;
    private routes;
    private pending;
    private jobs;
    start(options: StartOptions): Promise<ServerInfo>;
    stop(): Promise<void>;
    getInfo(): Promise<ServerInfo>;
    getPluginPlatform(): PluginPlatform;
    registerRoute(options: RouteOptions): Promise<RouteInfo>;
    unregisterRoute(options: RemoveRouteOptions): Promise<void>;
    clearRoutes(): Promise<void>;
    respond(options: RespondOptions): Promise<void>;
    completeJob(options: CompleteJobOptions): Promise<JobInfo>;
    failJob(options: FailJobOptions): Promise<JobInfo>;
    getJob(options: JobIdOptions): Promise<JobInfo>;
    listJobs(options?: ListJobsOptions): Promise<ListJobsResult>;
    deleteJob(options: JobIdOptions): Promise<void>;
    mockRequest(options: MockRequestOptions): Promise<RestResponse>;
    private createJob;
    private scheduleJobExpiry;
}
