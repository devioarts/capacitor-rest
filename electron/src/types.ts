export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type RouteMode = 'sync' | 'async';
export type BodyType = 'empty' | 'json' | 'text' | 'binary' | 'form' | 'multipart';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type PluginPlatform = 'ios' | 'android' | 'electron' | 'web';

export interface StartOptions {
  host?: string;
  port: number;
  cors?: CorsOptions;
  auth?: AuthOptions;
  maxBodySizeBytes?: number;
  requestTimeoutMs?: number;
  jobRetentionMs?: number;
  maxRetainedJobs?: number;
}

export interface CorsOptions {
  enabled?: boolean;
  origins?: string[];
  methods?: RestMethod[];
  headers?: string[];
  exposeHeaders?: string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export interface AuthOptions {
  type: 'bearer' | 'none';
  token?: string;
}

export interface ServerInfo {
  running: boolean;
  host: string;
  port: number;
  urls: string[];
  mock: boolean;
}

export interface RouteOptions {
  method: RestMethod;
  path: string;
  mode?: RouteMode;
  timeoutMs?: number;
}

export interface RouteInfo extends RouteOptions {
  mode: RouteMode;
}

export interface RouteRecord extends RouteInfo {
  segments: string[];
}

export interface RestRequest {
  id: string;
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
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: BodyType;
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

export interface ListJobsOptions {
  status?: JobStatus;
}

export interface ListJobsResult {
  jobs: JobInfo[];
}

export interface PendingRequest {
  resolve: (response: RestResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_JOB_RETENTION_MS = 300_000;
export const DEFAULT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_RETAINED_JOBS = 1000;

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(['completed', 'failed', 'cancelled', 'expired']);

/**
 * Distinguishes an explicit `stop()` call from a genuine request timeout so a pending
 * synchronous request can resolve with `503` (stopped) instead of `504` (timed out).
 */
export class ServerStoppedError extends Error {
  constructor() {
    super('Server stopped');
  }
}

export class BodyTooLargeError extends Error {
  constructor(maxBodySizeBytes: number) {
    super(`Payload too large. Maximum request body size is ${maxBodySizeBytes} bytes`);
  }
}
