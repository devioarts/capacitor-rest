import { createServer, connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: { sender: FakeWebContents }, type?: unknown) => void;
const ipcHandlers = new Map<string, IpcHandler[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, [...(ipcHandlers.get(channel) ?? []), handler]);
    }),
  },
}));

import { CapacitorREST } from '../electron/src/index';

class FakeWebContents {
  sent: Array<{ channel: string; payload: unknown }> = [];
  private destroyed = false;
  private handlers = new Map<string, Array<() => void>>();
  once(event: string, cb: () => void): void {
    this.on(event, cb);
  }
  on(event: string, cb: () => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }
  fire(event: string): void {
    for (const cb of this.handlers.get(event) ?? []) cb();
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
}

const emitIpc = (channel: string, sender: FakeWebContents, type?: unknown) => {
  for (const handler of ipcHandlers.get(channel) ?? []) handler({ sender }, type);
};

const plugins: any[] = [];
const create = (): any => {
  const plugin: any = new CapacitorREST();
  plugins.push(plugin);
  return plugin;
};
const local = { host: '127.0.0.1', port: 0 };

afterEach(async () => {
  for (const plugin of plugins.splice(0)) await plugin.stop().catch(() => undefined);
  ipcHandlers.clear();
});

describe('electron lifecycle', () => {
  it('does not report running after a failed start()', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    const plugin = create();
    await expect(plugin.start({ host: '127.0.0.1', port })).rejects.toThrow();
    expect((await plugin.getInfo()).running).toBe(false);
    blocker.close();
  });

  it('keeps a request pending when respond() gets a malformed response, so it can be retried', async () => {
    const plugin = create();
    const info = await plugin.start({ ...local, requestTimeoutMs: 5000 });
    await plugin.registerRoute({ method: 'GET', path: '/x' });
    const answer = fetch(`http://127.0.0.1:${info.port}/x`).then((response) => response.status);
    await vi.waitFor(() => expect(plugin.pending.size).toBe(1));
    const requestId = [...plugin.pending.keys()][0];

    await expect(plugin.respond({ requestId, status: 200, headers: null })).rejects.toThrow(/Invalid response/);
    expect(plugin.pending.size).toBe(1);

    await plugin.respond({ requestId, status: 201 });
    expect(await answer).toBe(201);
  });

  it('stop() resolves even when a client connection is stuck mid-request', async () => {
    const plugin = create();
    const info = await plugin.start(local);
    const socket = connect(info.port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial');
    socket.on('error', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      Promise.race([plugin.stop().then(() => 'stopped'), new Promise((r) => setTimeout(() => r('hung'), 4000))]),
    ).resolves.toBe('stopped');
    socket.destroy();
  }, 10000);

  it('rejects mockRequest() once the server is stopped', async () => {
    const plugin = create();
    await plugin.start(local);
    await plugin.stop();
    await expect(plugin.mockRequest({ method: 'GET', path: '/x' })).rejects.toThrow('Server is not running');
  });

  it('does not let a finished job be completed or failed again', async () => {
    const plugin = create();
    await plugin.start(local);
    await plugin.registerRoute({ method: 'POST', path: '/j', mode: 'async' });
    const { body } = await plugin.mockRequest({ method: 'POST', path: '/j' });
    await plugin.failJob({ jobId: body.jobId, error: 'stop', status: 'cancelled' });
    await expect(plugin.completeJob({ jobId: body.jobId, response: { status: 200 } })).rejects.toThrow(
      /already cancelled/,
    );
    await expect(plugin.failJob({ jobId: body.jobId, error: 'again' })).rejects.toThrow(/already cancelled/);
    expect((await plugin.getJob({ jobId: body.jobId })).status).toBe('cancelled');
  });

  it('rejects failJob() with a status other than failed/cancelled', async () => {
    const plugin = create();
    await plugin.start(local);
    await plugin.registerRoute({ method: 'POST', path: '/j', mode: 'async' });
    const { body } = await plugin.mockRequest({ method: 'POST', path: '/j' });
    await expect(plugin.failJob({ jobId: body.jobId, error: 'x', status: 'completed' })).rejects.toThrow(
      /status must be/,
    );
  });

  it('delivers events to every window that listens, and forgets listeners after a reload', async () => {
    const plugin = create();
    const first = new FakeWebContents();
    const second = new FakeWebContents();
    emitIpc('event-add-CapacitorREST', first, 'started');
    emitIpc('event-add-CapacitorREST', second, 'started');
    emitIpc('event-add-CapacitorREST', first, 'stopped');
    emitIpc('event-add-CapacitorREST', second, 'stopped');
    await plugin.start(local);
    expect(first.sent.map((entry) => entry.channel)).toContain('event-CapacitorREST-started');
    expect(second.sent.map((entry) => entry.channel)).toContain('event-CapacitorREST-started');

    first.sent.length = 0;
    first.fire('did-navigate');
    await plugin.stop();
    expect(first.sent).toHaveLength(0);
    expect(second.sent.map((entry) => entry.channel)).toContain('event-CapacitorREST-stopped');
  });
});
