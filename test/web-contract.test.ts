import { describe, it } from 'vitest';
import type { JobStatus, RestRequest, RestResponse, RouteOptions, ServerInfo, StartOptions } from '../src/definitions';
import { CapacitorREST } from '../src/index';
import { CapacitorRESTWeb } from '../src/web';
import { buildRestContractTests, type RestSuiteDriver } from '../playground/src/tests/restContract';

class WebContractDriver implements RestSuiteDriver {
  private plugin = new CapacitorRESTWeb();

  async start(options: StartOptions): Promise<ServerInfo> {
    return this.plugin.start(options);
  }

  async stop(): Promise<void> {
    await this.plugin.stop().catch(() => undefined);
  }

  async clearRoutes(): Promise<void> {
    await this.plugin.clearRoutes();
  }

  async registerRoute(options: RouteOptions): Promise<unknown> {
    return this.plugin.registerRoute(options);
  }

  async unregisterRoute(options: { method: string; path: string }): Promise<void> {
    await this.plugin.unregisterRoute(options as any);
  }

  async handleRequests(
    handler: (request: RestRequest) => Promise<RestResponse> | RestResponse,
  ): Promise<() => Promise<void>> {
    const handle = await this.plugin.addListener('request', async (request) => {
      try {
        const response = await handler(request);
        if (request.jobId) {
          await this.plugin.completeJob({ jobId: request.jobId, response }).catch(() => undefined);
          return;
        }
        await this.plugin.respond({ requestId: request.id, ...response }).catch(() => undefined);
      } catch (error) {
        if (request.jobId) {
          await this.plugin
            .failJob({ jobId: request.jobId, error: error instanceof Error ? error.message : String(error) })
            .catch(() => undefined);
          return;
        }
        await this.plugin
          .respond({
            requestId: request.id,
            status: 500,
            bodyType: 'json',
            body: { error: error instanceof Error ? error.message : String(error) },
          })
          .catch(() => undefined);
      }
    });
    return () => handle.remove();
  }

  async request(options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: RestRequest['bodyType'];
  }): Promise<RestResponse> {
    return this.plugin.mockRequest({
      method: options.method as any,
      path: options.path,
      headers: options.headers,
      body: options.body,
      bodyType: options.bodyType,
    });
  }

  async getJob(jobId: string): Promise<unknown> {
    return this.plugin.getJob({ jobId });
  }

  async listJobs(options?: { status?: JobStatus }): Promise<{ jobs: unknown[] }> {
    return this.plugin.listJobs(options);
  }
}

describe('REST contract: web mock', () => {
  for (const testCase of buildRestContractTests(() => new WebContractDriver())) {
    it(`[${testCase.group}] ${testCase.name}`, testCase.run);
  }

  it('reports port 0 because the web mock does not open a socket', async () => {
    const plugin = new CapacitorRESTWeb();
    await plugin.start({ port: 8080 });
    const info = await plugin.getInfo();
    await plugin.stop();
    if (info.port !== 0) {
      throw new Error(`Expected web mock port 0, got ${info.port}`);
    }
  });

  it('returns the public platform synchronously', () => {
    const platform = CapacitorREST.getPluginPlatform();
    if (platform !== 'web') {
      throw new Error(`Expected web platform, got ${platform}`);
    }
  });
});
