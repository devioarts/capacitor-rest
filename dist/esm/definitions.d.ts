import type { PluginListenerHandle } from '@capacitor/core';
export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type RouteMode = 'sync' | 'async';
export type BodyType = 'empty' | 'json' | 'text' | 'binary' | 'form' | 'multipart';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
export interface CorsOptions {
    enabled?: boolean;
    /**
     * Allowed request origins. Defaults to `['*']` (any origin).
     *
     * When `allowCredentials` is `true` and `origins` is left at the default
     * `['*']`, the server reflects back whatever `Origin` header the request
     * sent (browsers reject a literal `*` alongside credentials), which is
     * equivalent to allowing *any* website to make credentialed requests.
     * Always set an explicit allowlist here when `allowCredentials` is `true`.
     */
    origins?: string[];
    methods?: RestMethod[];
    headers?: string[];
    exposeHeaders?: string[];
    /**
     * Sends `Access-Control-Allow-Credentials: true` and, when `origins` is
     * left at the default `['*']`, reflects the request's `Origin` back
     * verbatim instead of sending a literal `*` (required by browsers for
     * credentialed requests). See the `origins` documentation above -
     * pair this with an explicit `origins` allowlist, otherwise any site can
     * make credentialed requests against this server.
     */
    allowCredentials?: boolean;
    maxAgeSeconds?: number;
}
export interface BearerAuthOptions {
    type: 'bearer';
    token: string;
}
export interface NoAuthOptions {
    type: 'none';
}
export type AuthOptions = BearerAuthOptions | NoAuthOptions;
export interface StartOptions {
    /**
     * Interface to bind. Use `127.0.0.1` for local-only access or `0.0.0.0`
     * when other devices on the LAN should be able to connect.
     */
    host?: string;
    /**
     * TCP port to listen on. Pass `0` to let the platform pick a free port and
     * read the selected value from `ServerInfo.port`. The web mock reports `0`
     * because it does not open a socket.
     */
    port: number;
    cors?: CorsOptions;
    auth?: AuthOptions;
    /**
     * Maximum accepted request body size in bytes. Requests over the limit return
     * `413 Payload Too Large` before they reach the JavaScript handler.
     *
     * Defaults to 10 MiB.
     */
    maxBodySizeBytes?: number;
    /**
     * Maximum time a synchronous route waits for `respond()`.
     * If the JavaScript handler settles after this window, the HTTP client has
     * already received `504 Gateway Timeout` and the late response is ignored.
     *
     * Defaults to 30 seconds.
     */
    requestTimeoutMs?: number;
    /**
     * Time an unfinished async job remains readable from `/__jobs/:jobId`.
     *
     * Defaults to 5 minutes.
     */
    jobRetentionMs?: number;
    /**
     * Maximum number of retained jobs (any status). Completed, failed,
     * cancelled, and expired jobs are not deleted automatically otherwise, so
     * without this cap a client that never calls `deleteJob()`/
     * `DELETE /__jobs/:jobId` would let retained jobs (including their
     * original request bodies) grow without bound. Once the cap is exceeded,
     * the oldest jobs in a terminal state (`completed`, `failed`, `cancelled`,
     * `expired`) are evicted first; jobs still `queued`/`running` are never
     * evicted by this cap.
     *
     * Defaults to 1000.
     */
    maxRetainedJobs?: number;
}
export interface ServerInfo {
    running: boolean;
    host: string;
    port: number;
    urls: string[];
    mock: boolean;
}
/**
 * The bridge implementation that actually handled the call - the cheapest way to confirm
 * whether a given platform is running its native server or falling back to the web mock.
 */
export type PluginPlatform = 'ios' | 'android' | 'electron' | 'web';
export interface RouteOptions {
    method: RestMethod;
    /**
     * Route pattern. Static segments, `:params`, and a trailing `*` wildcard are
     * supported, for example `/orders/:id` or `/files/*`.
     */
    path: string;
    /**
     * `sync` waits for `respond()`. `async` immediately returns `202 Accepted`
     * and completes through `completeJob()` or `failJob()`.
     */
    mode?: RouteMode;
    /**
     * Per-route override for `StartOptions.requestTimeoutMs` on synchronous
     * routes.
     */
    timeoutMs?: number;
}
export interface RouteInfo extends RouteOptions {
    mode: RouteMode;
}
export interface RemoveRouteOptions {
    method: RestMethod;
    path: string;
}
export interface RestRequest {
    id: string;
    /**
     * Present only for async routes. Use it with `completeJob()` or `failJob()`.
     */
    jobId?: string;
    method: RestMethod;
    path: string;
    route: string;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    headers: Record<string, string>;
    body?: unknown;
    bodyType: BodyType;
    remoteAddress?: string;
    receivedAt: string;
}
export interface RestResponse {
    /**
     * HTTP status code to send to the client.
     */
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: BodyType;
}
export interface RespondOptions extends RestResponse {
    requestId: string;
}
export interface MockRequestOptions {
    method: RestMethod;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: BodyType;
    remoteAddress?: string;
}
export interface JobInfo {
    jobId: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    request?: RestRequest;
    response?: RestResponse;
    error?: string;
}
export interface JobIdOptions {
    jobId: string;
}
export interface ListJobsOptions {
    /**
     * Optional status filter. Omit it to return every retained job.
     */
    status?: JobStatus;
}
export interface ListJobsResult {
    jobs: JobInfo[];
}
export interface CompleteJobOptions extends JobIdOptions {
    response: RestResponse;
}
export interface FailJobOptions extends JobIdOptions {
    error: string;
    status?: Extract<JobStatus, 'failed' | 'cancelled'>;
}
export interface RestServerEvent {
    info: ServerInfo;
}
export interface RestServerErrorEvent {
    message: string;
    code?: string;
}
export interface JobUpdatedEvent {
    job: JobInfo;
}
export type RestRequestHandler = (request: RestRequest) => RestResponse | Promise<RestResponse>;
export interface CapacitorRESTPlugin {
    start(options: StartOptions): Promise<ServerInfo>;
    stop(): Promise<void>;
    getInfo(): Promise<ServerInfo>;
    getPluginPlatform(): PluginPlatform;
    registerRoute(options: RouteOptions): Promise<RouteInfo>;
    unregisterRoute(options: RemoveRouteOptions): Promise<void>;
    clearRoutes(): Promise<void>;
    respond(options: RespondOptions): Promise<void>;
    /**
     * Rejects if `jobId` does not refer to a currently retained job. Unlike
     * the `GET /__jobs/:jobId` HTTP endpoint (which returns a plain
     * `404 { error: string }` response), this rejects the returned promise -
     * wrap calls in `try`/`catch`.
     */
    completeJob(options: CompleteJobOptions): Promise<JobInfo>;
    /**
     * Rejects if `jobId` does not refer to a currently retained job. See the
     * `completeJob()` note above.
     */
    failJob(options: FailJobOptions): Promise<JobInfo>;
    /**
     * Rejects if `jobId` does not refer to a currently retained job. See the
     * `completeJob()` note above.
     */
    getJob(options: JobIdOptions): Promise<JobInfo>;
    listJobs(options?: ListJobsOptions): Promise<ListJobsResult>;
    deleteJob(options: JobIdOptions): Promise<void>;
    mockRequest(options: MockRequestOptions): Promise<RestResponse>;
    addListener(eventName: 'request', listenerFunc: (event: RestRequest) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'started', listenerFunc: (event: RestServerEvent) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'stopped', listenerFunc: (event: RestServerEvent) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'error', listenerFunc: (event: RestServerErrorEvent) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'jobUpdated', listenerFunc: (event: JobUpdatedEvent) => void): Promise<PluginListenerHandle>;
}
