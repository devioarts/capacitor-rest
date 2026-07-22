import {
  CapacitorREST,
  handleRequests,
  type JobStatus,
  type RestRequest,
  type RestResponse,
  type RouteOptions,
  type ServerInfo,
  type StartOptions,
} from "@devioarts/capacitor-rest";
import type { RestSuiteDriver } from "../tests/restContract";

export class CapacitorRestDriver implements RestSuiteDriver {
  private info: ServerInfo | null = null;
  private listenerRemovers: Array<() => Promise<void>> = [];

  async start(options: StartOptions): Promise<ServerInfo> {
    this.info = await CapacitorREST.start(options);
    return this.info;
  }

  async stop(): Promise<void> {
    await this.removeListeners();
    await CapacitorREST.stop().catch(() => undefined);
    this.info = null;
  }

  async clearRoutes(): Promise<void> {
    await CapacitorREST.clearRoutes();
  }

  async registerRoute(options: RouteOptions): Promise<unknown> {
    return CapacitorREST.registerRoute(options);
  }

  async unregisterRoute(options: { method: string; path: string }): Promise<void> {
    await CapacitorREST.unregisterRoute(options as any);
  }

  async handleRequests(handler: (request: RestRequest) => Promise<RestResponse> | RestResponse): Promise<() => Promise<void>> {
    const handle = await handleRequests(handler);
    const remove = async () => {
      await handle.remove();
    };
    this.listenerRemovers.push(remove);
    return remove;
  }

  async request(options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: RestRequest["bodyType"];
  }): Promise<RestResponse> {
    const info = this.info ?? await CapacitorREST.getInfo();
    if (info.mock) {
      return CapacitorREST.mockRequest({
        method: options.method as any,
        path: options.path,
        headers: options.headers,
        body: options.body,
        bodyType: options.bodyType,
      });
    }

    const response = await fetch(`${localBaseUrl(info)}${options.path}`, {
      method: options.method,
      headers: options.headers,
      body: encodeBody(options.body, options.bodyType),
    });
    const bodyType = inferResponseBodyType(response);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyType,
      body: await decodeBody(response, bodyType),
    };
  }

  async getJob(jobId: string): Promise<unknown> {
    return CapacitorREST.getJob({ jobId });
  }

  async listJobs(options?: { status?: JobStatus }): Promise<{ jobs: unknown[] }> {
    return CapacitorREST.listJobs(options);
  }

  private async removeListeners(): Promise<void> {
    const removers = this.listenerRemovers.splice(0);
    await Promise.all(removers.map((remove) => remove().catch(() => undefined)));
  }
}

export function localBaseUrl(info: ServerInfo): string {
  return `http://127.0.0.1:${info.port}`;
}

function encodeBody(body: unknown, bodyType?: RestRequest["bodyType"]): BodyInit | undefined {
  if (body === undefined || body === null || bodyType === "empty") {
    return undefined;
  }
  if (bodyType === "binary" && typeof body === "string") {
    const raw = atob(body);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
  }
  if (bodyType === "json" || typeof body === "object") {
    return JSON.stringify(body);
  }
  if (typeof body === "string") {
    return body;
  }
  return String(body);
}

function inferResponseBodyType(response: Response): RestResponse["bodyType"] {
  if (response.status === 204) {
    return "empty";
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return "json";
  }
  if (contentType.startsWith("text/")) {
    return "text";
  }
  return "binary";
}

async function decodeBody(response: Response, bodyType: RestResponse["bodyType"]): Promise<unknown> {
  if (bodyType === "empty") {
    return undefined;
  }
  if (bodyType === "json") {
    return response.json();
  }
  if (bodyType === "text") {
    return response.text();
  }
  const buffer = await response.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
