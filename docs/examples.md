# React examples

These examples use the same API on Android, iOS, Electron, and the web mock adapter.

## 1. Minimal React setup

```tsx
import { useEffect, useState } from 'react';
import { CapacitorREST, handleRequests, type ServerInfo } from '@devioarts/capacitor-rest';

export function RestServerBootstrap() {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    let removeHandler: { remove: () => Promise<void> } | undefined;

    async function boot() {
      await CapacitorREST.registerRoute({ method: 'GET', path: '/health' });

      removeHandler = await handleRequests((request) => {
        if (request.route === '/health') {
          return { status: 200, bodyType: 'json', body: { ok: true } };
        }
        return { status: 404, bodyType: 'json', body: { error: 'Not found' } };
      });

      const server = await CapacitorREST.start({
        host: '127.0.0.1',
        port: 8080,
        auth: { type: 'none' },
        cors: { enabled: true, origins: ['*'] },
      });

      setInfo(server);
    }

    void boot();

    return () => {
      void removeHandler?.remove();
      void CapacitorREST.stop();
    };
  }, []);

  return <pre>{info ? JSON.stringify(info, null, 2) : 'Starting REST server...'}</pre>;
}
```

## 2. Hook with route registration

```tsx
import { useEffect, useState } from 'react';
import { CapacitorREST, handleRequests, type RestRequest, type RestResponse } from '@devioarts/capacitor-rest';

type Product = { id: string; name: string; price: number };

const products: Product[] = [
  { id: 'p-1', name: 'Notebook stand', price: 49 },
  { id: 'p-2', name: 'USB-C dock', price: 129 },
];

function routeProductRequest(request: RestRequest): RestResponse {
  if (request.method === 'GET' && request.route === '/products') {
    return { status: 200, bodyType: 'json', body: products };
  }

  if (request.method === 'GET' && request.route === '/products/:id') {
    const product = products.find((item) => item.id === request.params.id);
    return product
      ? { status: 200, bodyType: 'json', body: product }
      : { status: 404, bodyType: 'json', body: { error: 'Product not found' } };
  }

  return { status: 404, bodyType: 'json', body: { error: 'Route not found' } };
}

export function useProductRestServer() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let removeHandler: { remove: () => Promise<void> } | undefined;

    async function start() {
      await CapacitorREST.clearRoutes();
      await CapacitorREST.registerRoute({ method: 'GET', path: '/products' });
      await CapacitorREST.registerRoute({ method: 'GET', path: '/products/:id' });

      removeHandler = await handleRequests(routeProductRequest);
      await CapacitorREST.start({
        host: '0.0.0.0',
        port: 8080,
        auth: { type: 'bearer', token: import.meta.env.VITE_REST_TOKEN },
        cors: { enabled: true, origins: ['https://admin.example.com'] },
        maxBodySizeBytes: 1024 * 1024,
      });
      if (!disposed) setReady(true);
    }

    void start();

    return () => {
      disposed = true;
      setReady(false);
      void removeHandler?.remove();
      void CapacitorREST.stop();
    };
  }, []);

  return ready;
}
```

## 3. POST JSON with validation

```tsx
import { CapacitorREST, handleRequests, type RestRequest } from '@devioarts/capacitor-rest';

type CreateTodoBody = { title?: unknown };

function isCreateTodoBody(body: unknown): body is CreateTodoBody {
  return typeof body === 'object' && body !== null;
}

await CapacitorREST.registerRoute({ method: 'POST', path: '/todos' });

await handleRequests((request: RestRequest) => {
  if (request.route !== '/todos') {
    return { status: 404, bodyType: 'json', body: { error: 'Not found' } };
  }

  if (request.bodyType !== 'json' || !isCreateTodoBody(request.body) || typeof request.body.title !== 'string') {
    return { status: 400, bodyType: 'json', body: { error: 'Expected JSON body with title' } };
  }

  return {
    status: 201,
    bodyType: 'json',
    body: { id: crypto.randomUUID(), title: request.body.title.trim(), done: false },
  };
});

await CapacitorREST.start({
  host: '127.0.0.1',
  port: 8080,
  auth: { type: 'none' },
  maxBodySizeBytes: 256 * 1024,
});
```

## 4. Async import job with polling

```tsx
import { CapacitorREST, handleRequests } from '@devioarts/capacitor-rest';

await CapacitorREST.registerRoute({ method: 'POST', path: '/imports', mode: 'async' });

await handleRequests(async (request) => {
  if (request.route !== '/imports') {
    return { status: 404, bodyType: 'json', body: { error: 'Not found' } };
  }

  await runImportWithoutBlockingUi(request.body);

  return {
    status: 201,
    bodyType: 'json',
    body: { imported: true, jobId: request.jobId },
  };
});

await CapacitorREST.start({
  host: '0.0.0.0',
  port: 8080,
  auth: { type: 'bearer', token: 'replace-me' },
  requestTimeoutMs: 5000,
  jobRetentionMs: 10 * 60 * 1000,
});

async function runImportWithoutBlockingUi(input: unknown) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.info('Imported payload', input);
}
```

Client-side polling:

```ts
async function waitForJob(baseUrl: string, jobId: string, token: string) {
  while (true) {
    const response = await fetch(`${baseUrl}/__jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const job = await response.json();

    if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
```

React-side job list:

```tsx
import { useEffect, useState } from 'react';
import { CapacitorREST, type JobInfo, type JobStatus } from '@devioarts/capacitor-rest';

export function JobMonitor({ status }: { status?: JobStatus }) {
  const [jobs, setJobs] = useState<JobInfo[]>([]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      const result = await CapacitorREST.listJobs({ status });
      if (active) setJobs(result.jobs);
    }

    void refresh();
    const timer = window.setInterval(refresh, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status]);

  async function remove(jobId: string) {
    await CapacitorREST.deleteJob({ jobId });
    setJobs((current) => current.filter((job) => job.jobId !== jobId));
  }

  return (
    <ul>
      {jobs.map((job) => (
        <li key={job.jobId}>
          {job.status} {job.jobId}
          {['completed', 'failed', 'cancelled', 'expired'].includes(job.status) && (
            <button type="button" onClick={() => void remove(job.jobId)}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

## 5. File upload as base64

```tsx
import { CapacitorREST, handleRequests } from '@devioarts/capacitor-rest';

await CapacitorREST.registerRoute({ method: 'PUT', path: '/files/:name' });

await handleRequests((request) => {
  if (request.route !== '/files/:name' || request.bodyType !== 'binary' || typeof request.body !== 'string') {
    return { status: 400, bodyType: 'json', body: { error: 'Expected binary body' } };
  }

  return {
    status: 200,
    bodyType: 'json',
    body: {
      name: request.params.name,
      base64Length: request.body.length,
    },
  };
});

await CapacitorREST.start({
  host: '127.0.0.1',
  port: 8080,
  auth: { type: 'none' },
  maxBodySizeBytes: 5 * 1024 * 1024,
});
```

## 6. Electron-friendly long task

Keep the Electron main process as a transport layer. Register the plugin there, but run heavy route work in the renderer, a Web Worker, or another process.

```tsx
import { useEffect } from 'react';
import { CapacitorREST, handleRequests } from '@devioarts/capacitor-rest';

export function ElectronRestRoutes() {
  useEffect(() => {
    let removeHandler: { remove: () => Promise<void> } | undefined;

    async function start() {
      await CapacitorREST.registerRoute({ method: 'POST', path: '/reports', mode: 'async' });

      removeHandler = await handleRequests(async (request) => {
        const report = await buildReportInWorker(request.body);
        return { status: 201, bodyType: 'json', body: report };
      });

      await CapacitorREST.start({
        host: '127.0.0.1',
        port: 3030,
        auth: { type: 'bearer', token: 'desktop-local-token' },
        maxBodySizeBytes: 1024 * 1024,
      });
    }

    void start();

    return () => {
      void removeHandler?.remove();
      void CapacitorREST.stop();
    };
  }, []);

  return null;
}

async function buildReportInWorker(input: unknown) {
  const worker = new Worker(new URL('./report.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error);
    };
    worker.postMessage(input);
  });
}
```

## 7. Web mock in tests

`mockRequest()` is available on every platform for contract tests and local smoke checks. On web it does not open a real socket; on native platforms it follows the same route/auth/job contract as the HTTP server.

```ts
import { CapacitorREST, handleRequests } from '@devioarts/capacitor-rest';

await CapacitorREST.registerRoute({ method: 'GET', path: '/ping' });

const remove = await handleRequests(() => ({
  status: 200,
  bodyType: 'json',
  body: { pong: true },
}));

await CapacitorREST.start({ host: '127.0.0.1', port: 0, auth: { type: 'none' } });

const response = await CapacitorREST.mockRequest({ method: 'GET', path: '/ping' });

console.assert(response.status === 200);
console.assert(JSON.stringify(response.body) === JSON.stringify({ pong: true }));

await remove.remove();
await CapacitorREST.stop();
```
