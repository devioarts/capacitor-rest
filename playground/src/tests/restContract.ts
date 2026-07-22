import type {
  RestRequest,
  RestResponse,
  RouteOptions,
  ServerInfo,
  StartOptions,
  JobStatus,
} from "@devioarts/capacitor-rest";
import type { TestCase } from "./testRunner";

export interface RestSuiteDriver {
  start: (options: StartOptions) => Promise<ServerInfo>;
  stop: () => Promise<void>;
  clearRoutes: () => Promise<void>;
  registerRoute: (options: RouteOptions) => Promise<unknown>;
  unregisterRoute: (options: { method: string; path: string }) => Promise<void>;
  handleRequests: (handler: (request: RestRequest) => Promise<RestResponse> | RestResponse) => Promise<() => Promise<void> | void>;
  request: (options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyType?: RestRequest["bodyType"];
  }) => Promise<RestResponse>;
  getJob: (jobId: string) => Promise<unknown>;
  listJobs: (options?: { status?: JobStatus }) => Promise<{ jobs: unknown[] }>;
}

export type RestSuiteDriverFactory = () => RestSuiteDriver;

const token = "contract-token";

export function buildRestContractTests(createDriver: RestSuiteDriverFactory): TestCase[] {
  return [
    test("lifecycle", "starts, reports info, and stops", createDriver, async (driver) => {
      const info = await driver.start(baseStartOptions());
      assert(info.running, "server should be running");
      assert(typeof info.port === "number", "info.port should be a number");
      await driver.stop();
    }),

    test("routing", "handles RESTful route params and repeated query params", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/orders/:id" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: {
          method: request.method,
          route: request.route,
          id: request.params.id,
          expand: request.query.expand,
          tags: request.query.tag,
        },
      }));

      const response = await driver.request({
        method: "GET",
        path: "/orders/42?expand=items&tag=a&tag=b",
        headers: authHeaders(),
      });

      await remove();
      assertEqual(response.status, 200, "GET /orders/:id should return 200");
      assertDeepEqual(response.body, {
        method: "GET",
        route: "/orders/:id",
        id: "42",
        expand: "items",
        tags: ["a", "b"],
      });
    }),

    test("routing", "matches wildcard routes and decodes path params", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/files/*" });
      await driver.registerRoute({ method: "GET", path: "/users/:id" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: {
          route: request.route,
          wildcard: request.params["*"],
          id: request.params.id,
        },
      }));

      const file = await driver.request({
        method: "GET",
        path: "/files/reports/2026/summary.pdf",
        headers: authHeaders(),
      });
      const user = await driver.request({
        method: "GET",
        path: "/users/alice%20smith",
        headers: authHeaders(),
      });

      await remove();
      assertEqual(file.status, 200, "wildcard route should return 200");
      assertDeepEqual(file.body, { route: "/files/*", wildcard: "reports/2026/summary.pdf" });
      assertEqual(user.status, 200, "path param route should return 200");
      assertDeepEqual(user.body, { route: "/users/:id", id: "alice smith" });
    }),

    test("routing", "omits unset optional route fields as absent keys, not undefined values", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      const route = readObject(await driver.registerRoute({ method: "GET", path: "/no-timeout" }));

      assert(
        !Object.prototype.hasOwnProperty.call(route, "timeoutMs"),
        "unset timeoutMs should be an absent key on every platform, not present with value undefined",
      );
    }),

    test("routing", "matches routes even when a path param is malformed percent-encoding", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/users/:id" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: { id: request.params.id },
      }));

      const response = await driver.request({ method: "GET", path: "/users/%", headers: authHeaders() });

      await remove();
      assertEqual(response.status, 200, "malformed percent-encoding in a path param should not crash routing or reject the request");
    }),

    test("routing", "unregisters one route and clears the route table", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/temporary" });
      await driver.registerRoute({ method: "GET", path: "/remaining" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: { route: request.route },
      }));

      await driver.unregisterRoute({ method: "GET", path: "/temporary" });
      const removed = await driver.request({ method: "GET", path: "/temporary", headers: authHeaders() });
      const remaining = await driver.request({ method: "GET", path: "/remaining", headers: authHeaders() });

      await driver.clearRoutes();
      const cleared = await driver.request({ method: "GET", path: "/remaining", headers: authHeaders() });

      await remove();
      assertEqual(removed.status, 404, "unregistered route should not match");
      assertEqual(remaining.status, 200, "unregisterRoute should not remove other routes");
      assertEqual(cleared.status, 404, "clearRoutes should remove all routes");
    }),

    test("body", "round-trips a JSON POST body", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/orders" });
      const remove = await driver.handleRequests((request) => ({
        status: 201,
        bodyType: "json",
        body: {
          bodyType: request.bodyType,
          body: request.body,
        },
      }));

      const response = await driver.request({
        method: "POST",
        path: "/orders",
        headers: { ...authHeaders(), "content-type": "application/json" },
        bodyType: "json",
        body: { sku: "REST-1", qty: 3 },
      });

      await remove();
      assertEqual(response.status, 201, "POST /orders should return 201");
      assertDeepEqual(response.body, {
        bodyType: "json",
        body: { sku: "REST-1", qty: 3 },
      });
    }),

    test("body", "round-trips text and binary request bodies", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/echo" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: {
          bodyType: request.bodyType,
          body: request.body,
        },
      }));

      const text = await driver.request({
        method: "POST",
        path: "/echo",
        headers: { ...authHeaders(), "content-type": "text/plain" },
        bodyType: "text",
        body: "hello contract",
      });
      const binary = await driver.request({
        method: "POST",
        path: "/echo",
        headers: { ...authHeaders(), "content-type": "application/octet-stream" },
        bodyType: "binary",
        body: base64("contract-bytes"),
      });

      await remove();
      assertDeepEqual(text.body, { bodyType: "text", body: "hello contract" });
      assertDeepEqual(binary.body, { bodyType: "binary", body: base64("contract-bytes") });
    }),

    test("body", "rejects payloads over the configured limit before the handler runs", createDriver, async (driver) => {
      let handled = false;
      await driver.start({
        ...baseStartOptions(),
        maxBodySizeBytes: 8,
      });
      await driver.registerRoute({ method: "POST", path: "/limited" });
      const remove = await driver.handleRequests(() => {
        handled = true;
        return { status: 200, bodyType: "json", body: { ok: true } };
      });

      const response = await driver.request({
        method: "POST",
        path: "/limited",
        headers: { ...authHeaders(), "content-type": "text/plain" },
        bodyType: "text",
        body: "this is too large",
      });

      await remove();
      assertEqual(response.status, 413, "oversized request should return 413");
      assert(!handled, "oversized request should not reach the handler");
    }),

    test("body", "returns text and binary responses", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/text" });
      await driver.registerRoute({ method: "GET", path: "/binary" });
      const remove = await driver.handleRequests((request) => {
        if (request.route === "/binary") {
          return {
            status: 200,
            headers: { "x-contract": "binary" },
            bodyType: "binary",
            body: base64("binary-response"),
          };
        }
        return {
          status: 200,
          headers: { "x-contract": "text" },
          bodyType: "text",
          body: "plain response",
        };
      });

      const text = await driver.request({ method: "GET", path: "/text", headers: authHeaders() });
      const binary = await driver.request({ method: "GET", path: "/binary", headers: authHeaders() });

      await remove();
      assertEqual(text.status, 200, "text response should return 200");
      assertEqual(text.bodyType, "text", "text response should be decoded as text");
      assertEqual(text.body, "plain response");
      assertEqual(binary.status, 200, "binary response should return 200");
      assertEqual(binary.bodyType, "binary", "binary response should be decoded as binary");
      assertEqual(binary.body, base64("binary-response"));
    }),

    test("auth", "rejects missing bearer token and accepts the configured token", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/secure" });
      const remove = await driver.handleRequests(() => ({
        status: 200,
        bodyType: "json",
        body: { ok: true },
      }));

      const rejected = await driver.request({ method: "GET", path: "/secure" });
      const accepted = await driver.request({ method: "GET", path: "/secure", headers: authHeaders() });

      await remove();
      assertEqual(rejected.status, 401, "missing bearer token should return 401");
      assertEqual(accepted.status, 200, "valid bearer token should return 200");
    }),

    test("auth", "allows unauthenticated requests when auth type is none", createDriver, async (driver) => {
      await driver.start({
        ...baseStartOptions(),
        auth: { type: "none" },
      });
      await driver.registerRoute({ method: "GET", path: "/public" });
      const remove = await driver.handleRequests(() => ({
        status: 200,
        bodyType: "json",
        body: { public: true },
      }));

      const response = await driver.request({ method: "GET", path: "/public" });

      await remove();
      assertEqual(response.status, 200, "auth none should accept requests without Authorization");
      assertDeepEqual(response.body, { public: true });
    }),

    test("auth", "rejects an unknown auth type at startup", createDriver, async (driver) => {
      await assertRejects(
        () =>
          driver.start({
            ...baseStartOptions(),
            auth: { type: "baerer" } as StartOptions["auth"],
          }),
        "unknown auth.type should reject rather than silently disabling auth",
      );
    }),

    test("cors", "answers OPTIONS preflight with CORS headers", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      const response = await driver.request({
        method: "OPTIONS",
        path: "/orders",
        headers: {
          origin: "http://localhost.test",
          "access-control-request-method": "POST",
        },
      });
      assertEqual(response.status, 204, "OPTIONS should return 204");
      assertEqual(response.headers?.["access-control-allow-origin"], "*", "CORS origin header should be present");
    }),

    test("sync", "returns 504 when a sync route times out", createDriver, async (driver) => {
      await driver.start({
        ...baseStartOptions(),
        requestTimeoutMs: 25,
      });
      await driver.registerRoute({ method: "GET", path: "/slow" });
      const remove = await driver.handleRequests(async () => {
        await sleep(100);
        return { status: 200, bodyType: "json", body: { late: true } };
      });

      const response = await driver.request({ method: "GET", path: "/slow", headers: authHeaders() });

      await remove();
      assertEqual(response.status, 504, "timed-out sync route should return 504");
    }),

    test("sync", "returns 503 when stop() is called while a sync route is pending", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/pending" });
      await driver.handleRequests(() => new Promise<RestResponse>(() => undefined));

      const responsePromise = driver.request({ method: "GET", path: "/pending", headers: authHeaders() });
      await sleep(20);
      await driver.stop();
      const response = await responsePromise;

      assertEqual(response.status, 503, "stop() while a sync request is pending should return 503 (service stopped), not 504 (timed out)");
    }),

    test("sync", "supports HEAD routes without requiring a response body", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "HEAD", path: "/health" });
      const remove = await driver.handleRequests(() => ({
        status: 204,
        headers: { "x-health": "ok" },
        bodyType: "empty",
      }));

      const response = await driver.request({ method: "HEAD", path: "/health", headers: authHeaders() });

      await remove();
      assertEqual(response.status, 204, "HEAD route should return handler status");
      assertEqual(response.headers?.["x-health"], "ok", "HEAD route should preserve headers");
    }),

    test("async jobs", "returns 202 immediately and completes the job resource", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/imports", mode: "async" });
      const remove = await driver.handleRequests((request) => ({
        status: 201,
        bodyType: "json",
        body: {
          imported: true,
          jobId: request.jobId,
        },
      }));

      const accepted = await driver.request({
        method: "POST",
        path: "/imports",
        headers: authHeaders(),
        bodyType: "json",
        body: { source: "contract" },
      });

      assertEqual(accepted.status, 202, "async route should return 202");
      const jobId = readObject(accepted.body).jobId;
      assert(typeof jobId === "string" && jobId.length > 0, "async response should include jobId");

      const job = await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "completed");
      const listed = await driver.listJobs({ status: "completed" });
      const listedJobIds = listed.jobs.map((value) => readObject(value).jobId);
      await remove();
      assertEqual(job.status, "completed", "job should be completed by handler return value");
      assert(listedJobIds.includes(jobId), "listJobs should include completed async job");
      assertDeepEqual(readObject(job.response).body, { imported: true, jobId });
    }),

    test("async jobs", "records failed jobs when the handler throws", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/failures", mode: "async" });
      const remove = await driver.handleRequests(() => {
        throw new Error("import failed");
      });

      const accepted = await driver.request({
        method: "POST",
        path: "/failures",
        headers: authHeaders(),
        bodyType: "json",
        body: { source: "bad" },
      });

      const jobId = readObject(accepted.body).jobId;
      const job = await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "failed");

      await remove();
      assertEqual(accepted.status, 202, "async failure should still return 202 first");
      assertEqual(job.status, "failed", "job should be marked failed");
      assertEqual(job.error, "import failed", "job should expose failure message");
    }),

    test("async jobs", "exposes retained jobs over GET /__jobs", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/exports", mode: "async" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: { exported: true, jobId: request.jobId },
      }));

      const accepted = await driver.request({
        method: "POST",
        path: "/exports",
        headers: authHeaders(),
        bodyType: "json",
        body: { format: "csv" },
      });
      const jobId = readObject(accepted.body).jobId;
      await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "completed");

      const response = await driver.request({
        method: "GET",
        path: "/__jobs?status=completed",
        headers: authHeaders(),
      });

      await remove();
      assertEqual(response.status, 200, "GET /__jobs should return 200");
      const jobs = readObject(response.body).jobs as unknown[];
      assert(jobs.some((value) => readObject(value).jobId === jobId), "GET /__jobs should include completed job");
    }),

    test("async jobs", "deletes jobs through DELETE /__jobs/:jobId", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "POST", path: "/cleanup", mode: "async" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: { jobId: request.jobId },
      }));

      const accepted = await driver.request({
        method: "POST",
        path: "/cleanup",
        headers: authHeaders(),
        bodyType: "json",
        body: { cleanup: true },
      });
      const jobId = readObject(accepted.body).jobId;
      await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "completed");

      const deleted = await driver.request({
        method: "DELETE",
        path: `/__jobs/${encodeURIComponent(jobId)}`,
        headers: authHeaders(),
      });
      const missing = await driver.request({
        method: "GET",
        path: `/__jobs/${encodeURIComponent(jobId)}`,
        headers: authHeaders(),
      });

      await remove();
      assertEqual(deleted.status, 204, "DELETE /__jobs/:jobId should return 204");
      assertEqual(missing.status, 404, "deleted job should no longer be readable");
    }),

    test("async jobs", "expires unfinished async jobs after the retention window", createDriver, async (driver) => {
      await driver.start({
        ...baseStartOptions(),
        jobRetentionMs: 35,
      });
      await driver.registerRoute({ method: "POST", path: "/expire", mode: "async" });
      const remove = await driver.handleRequests(() => new Promise<RestResponse>(() => undefined));

      const accepted = await driver.request({
        method: "POST",
        path: "/expire",
        headers: authHeaders(),
        bodyType: "json",
        body: { keep: false },
      });
      const jobId = readObject(accepted.body).jobId;
      const job = await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "expired");

      await remove();
      assertEqual(job.status, "expired", "unfinished job should expire");
    }),

    test("async jobs", "resolves 404 instead of rejecting for a malformed job-id path segment", createDriver, async (driver) => {
      await driver.start(baseStartOptions());

      const response = await driver.request({ method: "GET", path: "/__jobs/%", headers: authHeaders() });

      assertEqual(response.status, 404, "a malformed percent-encoded job id should resolve as not-found, not reject the promise");
    }),

    test("async jobs", "evicts the oldest terminal jobs once maxRetainedJobs is exceeded", createDriver, async (driver) => {
      await driver.start({
        ...baseStartOptions(),
        maxRetainedJobs: 2,
      });
      await driver.registerRoute({ method: "POST", path: "/capped", mode: "async" });
      const remove = await driver.handleRequests((request) => ({
        status: 200,
        bodyType: "json",
        body: { jobId: request.jobId },
      }));

      const jobIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const accepted = await driver.request({
          method: "POST",
          path: "/capped",
          headers: authHeaders(),
          bodyType: "json",
          body: { index },
        });
        const jobId = readObject(accepted.body).jobId as string;
        await waitFor(async () => readObject(await driver.getJob(jobId)), (value) => value.status === "completed");
        jobIds.push(jobId);
      }

      await remove();
      const listed = await driver.listJobs();
      const retainedIds = listed.jobs.map((value) => readObject(value).jobId);
      assertEqual(retainedIds.length, 2, "only maxRetainedJobs completed jobs should remain retained");
      assert(!retainedIds.includes(jobIds[0]), "the oldest completed job should have been evicted first");
      assert(retainedIds.includes(jobIds[2]), "the newest completed job should still be retained");
    }),

    test("concurrency", "serves multiple parallel sync requests", createDriver, async (driver) => {
      await driver.start(baseStartOptions());
      await driver.registerRoute({ method: "GET", path: "/parallel/:id" });
      const remove = await driver.handleRequests(async (request) => {
        await sleep(10);
        return {
          status: 200,
          bodyType: "json",
          body: { id: request.params.id },
        };
      });

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          driver.request({
            method: "GET",
            path: `/parallel/${index + 1}`,
            headers: authHeaders(),
          }),
        ),
      );

      await remove();
      assertDeepEqual(
        responses.map((response) => readObject(response.body).id),
        ["1", "2", "3", "4", "5", "6"],
      );
    }),
  ];
}

function test(
  group: string,
  name: string,
  createDriver: RestSuiteDriverFactory,
  run: (driver: RestSuiteDriver) => Promise<void>,
): TestCase {
  return {
    group,
    name,
    run: async () => {
      const driver = createDriver();
      try {
        await run(driver);
      } finally {
        await driver.stop().catch(() => undefined);
      }
    },
  };
}

function baseStartOptions(): StartOptions {
  return {
    host: "127.0.0.1",
    port: 0,
    auth: { type: "bearer", token },
    cors: { enabled: true, origins: ["*"] },
    requestTimeoutMs: 2000,
    jobRetentionMs: 10000,
  };
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function base64(value: string): string {
  return btoa(value);
}

function assert(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

async function assertRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

function readObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object") {
    return value as Record<string, any>;
  }
  throw new Error(`Expected object, got ${String(value)}`);
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2000;
  let last: T;
  do {
    last = await read();
    if (done(last)) {
      return last;
    }
    await sleep(25);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for condition");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
