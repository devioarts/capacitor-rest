import { describe, it, vi } from 'vitest';
import type { JobStatus, RestRequest, RestResponse, RouteOptions, ServerInfo, StartOptions } from '../src/definitions';
import { buildRestContractTests, type RestSuiteDriver } from '../playground/src/tests/restContract';
import { CapacitorREST as ElectronREST } from '../electron/src/index';

type IpcHandler = (event: { sender: FakeWebContents }, type?: unknown) => void;
const ipcHandlers = new Map<string, IpcHandler[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: IpcHandler) => {
      const handlers = ipcHandlers.get(channel) ?? [];
      handlers.push(handler);
      ipcHandlers.set(channel, handlers);
    }),
  },
}));

class FakeWebContents {
  private destroyed = false;
  private destroyCallbacks: Array<() => void> = [];
  onRequest?: (request: RestRequest) => void;

  once(event: 'destroyed', callback: () => void): void {
    if (event === 'destroyed') {
      this.destroyCallbacks.push(callback);
    }
  }

  on(): void {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    for (const callback of this.destroyCallbacks) callback();
  }

  send(channel: string, payload: unknown): void {
    if (channel === 'event-CapacitorREST-request') {
      this.onRequest?.(payload as RestRequest);
    }
  }
}

class ElectronContractDriver implements RestSuiteDriver {
  private plugin: any;
  private webContents = new FakeWebContents();
  private info: ServerInfo | null = null;

  constructor() {
    this.plugin = new ElectronREST();
    this.attach('request');
  }

  async start(options: StartOptions): Promise<ServerInfo> {
    this.info = await this.plugin.start(options);
    return this.info;
  }

  async stop(): Promise<void> {
    await this.plugin.stop().catch(() => undefined);
    this.webContents.destroy();
  }

  async clearRoutes(): Promise<void> {
    await this.plugin.clearRoutes();
  }

  async registerRoute(options: RouteOptions): Promise<unknown> {
    return this.plugin.registerRoute(options);
  }

  async unregisterRoute(options: { method: string; path: string }): Promise<void> {
    await this.plugin.unregisterRoute(options);
  }

  async handleRequests(
    handler: (request: RestRequest) => Promise<RestResponse> | RestResponse,
  ): Promise<() => Promise<void>> {
    this.webContents.onRequest = (request) => {
      Promise.resolve()
        .then(() => handler(request))
        .then((response) => {
          if (request.jobId) {
            return this.plugin.completeJob({ jobId: request.jobId, response }).catch(() => undefined);
          }
          return this.plugin.respond({ requestId: request.id, ...response }).catch(() => undefined);
        })
        .catch((error) => {
          if (request.jobId) {
            return this.plugin
              .failJob({ jobId: request.jobId, error: error instanceof Error ? error.message : String(error) })
              .catch(() => undefined);
          }
          return this.plugin
            .respond({
              requestId: request.id,
              status: 500,
              bodyType: 'json',
              body: { error: error instanceof Error ? error.message : String(error) },
            })
            .catch(() => undefined);
        });
    };
    return async () => {
      this.webContents.onRequest = undefined;
    };
  }

  async request(options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: RestRequest['bodyType'];
  }): Promise<RestResponse> {
    const info = this.info ?? (await this.plugin.getInfo());
    const response = await fetch(`http://127.0.0.1:${info.port}${options.path}`, {
      method: options.method,
      headers: options.headers,
      body: encodeBody(options.body, options.bodyType),
    });
    const bodyType =
      response.status === 204 || options.method === 'HEAD'
        ? 'empty'
        : response.headers.get('content-type')?.includes('application/json')
          ? 'json'
          : response.headers.get('content-type')?.startsWith('text/')
            ? 'text'
            : 'binary';
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyType,
      body: await decodeBody(response, bodyType),
    };
  }

  async getJob(jobId: string): Promise<unknown> {
    return this.plugin.getJob({ jobId });
  }

  async listJobs(options?: { status?: JobStatus }): Promise<{ jobs: unknown[] }> {
    return this.plugin.listJobs(options);
  }

  private attach(eventName: string): void {
    for (const handler of ipcHandlers.get('event-add-CapacitorREST') ?? []) {
      handler({ sender: this.webContents }, eventName);
    }
  }
}

function encodeBody(body: unknown, bodyType?: RestRequest['bodyType']): BodyInit | undefined {
  if (body === undefined || body === null || bodyType === 'empty') {
    return undefined;
  }
  if (bodyType === 'binary' && typeof body === 'string') {
    return Buffer.from(body, 'base64');
  }
  if (bodyType === 'json' || (bodyType === undefined && typeof body === 'object')) {
    return JSON.stringify(body);
  }
  return String(body);
}

async function decodeBody(response: Response, bodyType: RestResponse['bodyType']): Promise<unknown> {
  if (bodyType === 'empty') {
    return undefined;
  }
  if (bodyType === 'json') {
    return response.json();
  }
  if (bodyType === 'text') {
    return response.text();
  }
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

describe('REST contract: Electron HTTP server', () => {
  for (const testCase of buildRestContractTests(() => new ElectronContractDriver())) {
    it(`[${testCase.group}] ${testCase.name}`, testCase.run);
  }

  it('returns the Electron platform synchronously on the direct adapter', () => {
    const plugin = new ElectronREST();
    const platform = plugin.getPluginPlatform();
    if (platform !== 'electron') {
      throw new Error(`Expected electron platform, got ${platform}`);
    }
  });
});
