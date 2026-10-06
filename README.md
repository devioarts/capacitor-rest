# @devioarts/capacitor-rest

REST server for CapacitorJS

## Install

```bash
npm install @devioarts/capacitor-rest
```

Install directly from GitHub

```bash
npm install github:devioarts/capacitor-rest
```

Sync native files

```bash
npx cap sync
```

## Usage

Register RESTful resources once and keep the same API on Android, iOS, Electron, and the web mock.

```typescript
import { CapacitorREST, handleRequests } from '@devioarts/capacitor-rest';

await CapacitorREST.registerRoute({
  method: 'GET',
  path: '/orders/:id',
});

await handleRequests(async (request) => {
  if (request.method === 'GET' && request.route === '/orders/:id') {
    return {
      status: 200,
      bodyType: 'json',
      body: { id: request.params.id, status: 'ready' },
    };
  }

  return {
    status: 404,
    bodyType: 'json',
    body: { error: 'Resource not found' },
  };
});

await CapacitorREST.start({
  host: '0.0.0.0',
  port: 8080,
  auth: { type: 'bearer', token: 'change-me' },
  cors: { enabled: true, origins: ['*'] },
  maxBodySizeBytes: 10 * 1024 * 1024,
});
```

Async routes return `202 Accepted` with a job resource location immediately.

```typescript
await CapacitorREST.registerRoute({
  method: 'POST',
  path: '/imports',
  mode: 'async',
});

await handleRequests(async (request) => {
  if (request.route === '/imports') {
    // Returning a response from an async route completes the job.
    return {
      status: 201,
      bodyType: 'json',
      body: { imported: true, jobId: request.jobId },
    };
  }

  return {
    status: 404,
    bodyType: 'json',
    body: { error: 'Resource not found' },
  };
});
```

Job resources are exposed as:

```text
GET    /__jobs
GET    /__jobs?status=completed
GET    /__jobs/:jobId
DELETE /__jobs/:jobId
```

`GET /__jobs` and `CapacitorREST.listJobs()` return retained jobs as `{ jobs: JobInfo[] }`. Use the optional `status` filter for queues, dashboards, and cleanup screens. Completed jobs stay readable until you delete them, so call `DELETE /__jobs/:jobId` or `CapacitorREST.deleteJob({ jobId })` after the client has consumed the result.

For more React examples, including hooks, async jobs, protected routes, uploads, and Electron-friendly patterns, see [docs/examples.md](./docs/examples.md).

## Stability notes

- Always set `auth` for servers bound to `0.0.0.0`; otherwise every device on the same network can call the routes.
- Only set `cors.allowCredentials: true` together with an explicit `cors.origins` allowlist. With the default `origins: ['*']`, enabling credentials makes the server reflect back *any* request's `Origin` header instead of sending a literal `*` (browsers require this for credentialed requests) - effectively allowing any website to make credentialed requests against your server.
- Use `maxBodySizeBytes` to keep memory bounded. Requests over the limit return `413 Payload Too Large` and are not forwarded to your JavaScript route handler.
- Use `maxRetainedJobs` to bound memory used by retained async jobs. Completed/failed/cancelled/expired jobs are not deleted automatically, so a client that never calls `deleteJob()`/`DELETE /__jobs/:jobId` would otherwise let retained jobs grow without limit; once the cap is exceeded, the oldest jobs in a terminal state are evicted first. Defaults to 1000.
- Prefer `mode: 'async'` for slow work. The HTTP client receives `202 Accepted` immediately and can poll `GET /__jobs/:jobId`.
- On Electron, the HTTP server uses Node's asynchronous networking and waits for renderer responses without busy-waiting. Keep CPU-heavy work out of the Electron main process; run it in the renderer, a worker, or a separate process, then complete the route with `respond()` or `completeJob()`.
- Register routes and attach `handleRequests()` before `start()` so the socket is not reachable before your handler is ready. After a WebView reload, attach a fresh handler and re-register/replace routes before exposing the server again.
- Mobile apps only serve requests while the app is running in the foreground. Android stops the server together with the Activity (there is no foreground service), and iOS may close the listening socket while the app is suspended - after returning to the foreground the plugin emits an `error` event and `getInfo().running` becomes `false`, so call `start()` again. Plan for clients to retry.
- A job that has already completed, failed, been cancelled or expired cannot be completed or failed again (`completeJob()`/`failJob()` reject). `failJob()` only accepts the statuses `failed` and `cancelled`.
- `stop()` answers in-flight synchronous requests with `503` and closes connections that are still busy after a short grace period.

For Electron, import the desktop adapter from the secondary export and register it with your Electron Capacitor setup:

```typescript
import { CapacitorREST } from '@devioarts/capacitor-rest/electron';
```

## Testing

```bash
npm test
```

This runs `test:ts` (the automated contract suite, which shares the same REST scenarios used by the playground and runs against the web mock adapter and the Electron HTTP server, covering lifecycle, routing, params and wildcard matching, JSON/text/binary bodies, auth, CORS, sync timeouts, async jobs, retained job resources, deletion, expiry, and parallel requests) plus the native `test:android`/`test:ios` suites. Run `npm run test:ts` on its own for just the TypeScript contract suite.

Manual platform testing lives in `playground/`:

```bash
cd playground
npm run build
npm run open-android
npm run open-ios
npm run open-electron
```

## API

<docgen-index>

* [`start(...)`](#start)
* [`stop()`](#stop)
* [`getInfo()`](#getinfo)
* [`getPluginPlatform()`](#getpluginplatform)
* [`registerRoute(...)`](#registerroute)
* [`unregisterRoute(...)`](#unregisterroute)
* [`clearRoutes()`](#clearroutes)
* [`respond(...)`](#respond)
* [`completeJob(...)`](#completejob)
* [`failJob(...)`](#failjob)
* [`getJob(...)`](#getjob)
* [`listJobs(...)`](#listjobs)
* [`deleteJob(...)`](#deletejob)
* [`mockRequest(...)`](#mockrequest)
* [`addListener('request', ...)`](#addlistenerrequest-)
* [`addListener('started', ...)`](#addlistenerstarted-)
* [`addListener('stopped', ...)`](#addlistenerstopped-)
* [`addListener('error', ...)`](#addlistenererror-)
* [`addListener('jobUpdated', ...)`](#addlistenerjobupdated-)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### start(...)

```typescript
start(options: StartOptions) => Promise<ServerInfo>
```

| Param         | Type                                                  |
| ------------- | ----------------------------------------------------- |
| **`options`** | <code><a href="#startoptions">StartOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#serverinfo">ServerInfo</a>&gt;</code>

--------------------


### stop()

```typescript
stop() => Promise<void>
```

--------------------


### getInfo()

```typescript
getInfo() => Promise<ServerInfo>
```

**Returns:** <code>Promise&lt;<a href="#serverinfo">ServerInfo</a>&gt;</code>

--------------------


### getPluginPlatform()

```typescript
getPluginPlatform() => PluginPlatform
```

**Returns:** <code><a href="#pluginplatform">PluginPlatform</a></code>

--------------------


### registerRoute(...)

```typescript
registerRoute(options: RouteOptions) => Promise<RouteInfo>
```

| Param         | Type                                                  |
| ------------- | ----------------------------------------------------- |
| **`options`** | <code><a href="#routeoptions">RouteOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#routeinfo">RouteInfo</a>&gt;</code>

--------------------


### unregisterRoute(...)

```typescript
unregisterRoute(options: RemoveRouteOptions) => Promise<void>
```

| Param         | Type                                                              |
| ------------- | ----------------------------------------------------------------- |
| **`options`** | <code><a href="#removerouteoptions">RemoveRouteOptions</a></code> |

--------------------


### clearRoutes()

```typescript
clearRoutes() => Promise<void>
```

--------------------


### respond(...)

```typescript
respond(options: RespondOptions) => Promise<void>
```

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#respondoptions">RespondOptions</a></code> |

--------------------


### completeJob(...)

```typescript
completeJob(options: CompleteJobOptions) => Promise<JobInfo>
```

Rejects if `jobId` does not refer to a currently retained job. Unlike
the `GET /__jobs/:jobId` HTTP endpoint (which returns a plain
`404 { error: string }` response), this rejects the returned promise -
wrap calls in `try`/`catch`.

| Param         | Type                                                              |
| ------------- | ----------------------------------------------------------------- |
| **`options`** | <code><a href="#completejoboptions">CompleteJobOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#jobinfo">JobInfo</a>&gt;</code>

--------------------


### failJob(...)

```typescript
failJob(options: FailJobOptions) => Promise<JobInfo>
```

Rejects if `jobId` does not refer to a currently retained job. See the
`completeJob()` note above.

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#failjoboptions">FailJobOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#jobinfo">JobInfo</a>&gt;</code>

--------------------


### getJob(...)

```typescript
getJob(options: JobIdOptions) => Promise<JobInfo>
```

Rejects if `jobId` does not refer to a currently retained job. See the
`completeJob()` note above.

| Param         | Type                                                  |
| ------------- | ----------------------------------------------------- |
| **`options`** | <code><a href="#jobidoptions">JobIdOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#jobinfo">JobInfo</a>&gt;</code>

--------------------


### listJobs(...)

```typescript
listJobs(options?: ListJobsOptions | undefined) => Promise<ListJobsResult>
```

| Param         | Type                                                        |
| ------------- | ----------------------------------------------------------- |
| **`options`** | <code><a href="#listjobsoptions">ListJobsOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#listjobsresult">ListJobsResult</a>&gt;</code>

--------------------


### deleteJob(...)

```typescript
deleteJob(options: JobIdOptions) => Promise<void>
```

| Param         | Type                                                  |
| ------------- | ----------------------------------------------------- |
| **`options`** | <code><a href="#jobidoptions">JobIdOptions</a></code> |

--------------------


### mockRequest(...)

```typescript
mockRequest(options: MockRequestOptions) => Promise<RestResponse>
```

| Param         | Type                                                              |
| ------------- | ----------------------------------------------------------------- |
| **`options`** | <code><a href="#mockrequestoptions">MockRequestOptions</a></code> |

**Returns:** <code>Promise&lt;<a href="#restresponse">RestResponse</a>&gt;</code>

--------------------


### addListener('request', ...)

```typescript
addListener(eventName: 'request', listenerFunc: (event: RestRequest) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| **`eventName`**    | <code>'request'</code>                                                  |
| **`listenerFunc`** | <code>(event: <a href="#restrequest">RestRequest</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('started', ...)

```typescript
addListener(eventName: 'started', listenerFunc: (event: RestServerEvent) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'started'</code>                                                          |
| **`listenerFunc`** | <code>(event: <a href="#restserverevent">RestServerEvent</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('stopped', ...)

```typescript
addListener(eventName: 'stopped', listenerFunc: (event: RestServerEvent) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'stopped'</code>                                                          |
| **`listenerFunc`** | <code>(event: <a href="#restserverevent">RestServerEvent</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('error', ...)

```typescript
addListener(eventName: 'error', listenerFunc: (event: RestServerErrorEvent) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'error'</code>                                                                      |
| **`listenerFunc`** | <code>(event: <a href="#restservererrorevent">RestServerErrorEvent</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('jobUpdated', ...)

```typescript
addListener(eventName: 'jobUpdated', listenerFunc: (event: JobUpdatedEvent) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'jobUpdated'</code>                                                       |
| **`listenerFunc`** | <code>(event: <a href="#jobupdatedevent">JobUpdatedEvent</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### Interfaces


#### ServerInfo

| Prop          | Type                  |
| ------------- | --------------------- |
| **`running`** | <code>boolean</code>  |
| **`host`**    | <code>string</code>   |
| **`port`**    | <code>number</code>   |
| **`urls`**    | <code>string[]</code> |
| **`mock`**    | <code>boolean</code>  |


#### StartOptions

| Prop                   | Type                                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`host`**             | <code>string</code>                                 | Interface to bind. Use `127.0.0.1` for local-only access or `0.0.0.0` when other devices on the LAN should be able to connect.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`port`**             | <code>number</code>                                 | TCP port to listen on. Pass `0` to let the platform pick a free port and read the selected value from <a href="#serverinfo">`ServerInfo.port`</a>. The web mock reports `0` because it does not open a socket.                                                                                                                                                                                                                                                                                                                   |
| **`cors`**             | <code><a href="#corsoptions">CorsOptions</a></code> |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`auth`**             | <code><a href="#authoptions">AuthOptions</a></code> |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`maxBodySizeBytes`** | <code>number</code>                                 | Maximum accepted request body size in bytes. Requests over the limit return `413 Payload Too Large` before they reach the JavaScript handler. Defaults to 10 MiB.                                                                                                                                                                                                                                                                                                                                                                |
| **`requestTimeoutMs`** | <code>number</code>                                 | Maximum time a synchronous route waits for `respond()`. If the JavaScript handler settles after this window, the HTTP client has already received `504 Gateway Timeout` and the late response is ignored. Defaults to 30 seconds.                                                                                                                                                                                                                                                                                                |
| **`jobRetentionMs`**   | <code>number</code>                                 | Time an unfinished async job remains readable from `/__jobs/:jobId`. Defaults to 5 minutes.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`maxRetainedJobs`**  | <code>number</code>                                 | Maximum number of retained jobs (any status). Completed, failed, cancelled, and expired jobs are not deleted automatically otherwise, so without this cap a client that never calls `deleteJob()`/ `DELETE /__jobs/:jobId` would let retained jobs (including their original request bodies) grow without bound. Once the cap is exceeded, the oldest jobs in a terminal state (`completed`, `failed`, `cancelled`, `expired`) are evicted first; jobs still `queued`/`running` are never evicted by this cap. Defaults to 1000. |


#### CorsOptions

| Prop                   | Type                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`enabled`**          | <code>boolean</code>      |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`origins`**          | <code>string[]</code>     | Allowed request origins. Defaults to `['*']` (any origin). When `allowCredentials` is `true` and `origins` is left at the default `['*']`, the server reflects back whatever `Origin` header the request sent (browsers reject a literal `*` alongside credentials), which is equivalent to allowing *any* website to make credentialed requests. Always set an explicit allowlist here when `allowCredentials` is `true`. |
| **`methods`**          | <code>RestMethod[]</code> |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`headers`**          | <code>string[]</code>     |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`exposeHeaders`**    | <code>string[]</code>     |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`allowCredentials`** | <code>boolean</code>      | Sends `Access-Control-Allow-Credentials: true` and, when `origins` is left at the default `['*']`, reflects the request's `Origin` back verbatim instead of sending a literal `*` (required by browsers for credentialed requests). See the `origins` documentation above - pair this with an explicit `origins` allowlist, otherwise any site can make credentialed requests against this server.                         |
| **`maxAgeSeconds`**    | <code>number</code>       |                                                                                                                                                                                                                                                                                                                                                                                                                            |


#### BearerAuthOptions

| Prop        | Type                  |
| ----------- | --------------------- |
| **`type`**  | <code>'bearer'</code> |
| **`token`** | <code>string</code>   |


#### NoAuthOptions

| Prop       | Type                |
| ---------- | ------------------- |
| **`type`** | <code>'none'</code> |


#### RouteInfo

| Prop       | Type                                            | Description                                                                                                                    |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **`mode`** | <code><a href="#routemode">RouteMode</a></code> | `sync` waits for `respond()`. `async` immediately returns `202 Accepted` and completes through `completeJob()` or `failJob()`. |


#### RouteOptions

| Prop            | Type                                              | Description                                                                                                                    |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **`method`**    | <code><a href="#restmethod">RestMethod</a></code> |                                                                                                                                |
| **`path`**      | <code>string</code>                               | Route pattern. Static segments, `:params`, and a trailing `*` wildcard are supported, for example `/orders/:id` or `/files/*`. |
| **`mode`**      | <code><a href="#routemode">RouteMode</a></code>   | `sync` waits for `respond()`. `async` immediately returns `202 Accepted` and completes through `completeJob()` or `failJob()`. |
| **`timeoutMs`** | <code>number</code>                               | Per-route override for <a href="#startoptions">`StartOptions.requestTimeoutMs`</a> on synchronous routes.                      |


#### RemoveRouteOptions

| Prop         | Type                                              |
| ------------ | ------------------------------------------------- |
| **`method`** | <code><a href="#restmethod">RestMethod</a></code> |
| **`path`**   | <code>string</code>                               |


#### RespondOptions

| Prop            | Type                |
| --------------- | ------------------- |
| **`requestId`** | <code>string</code> |


#### JobInfo

| Prop            | Type                                                  |
| --------------- | ----------------------------------------------------- |
| **`jobId`**     | <code>string</code>                                   |
| **`status`**    | <code><a href="#jobstatus">JobStatus</a></code>       |
| **`createdAt`** | <code>string</code>                                   |
| **`updatedAt`** | <code>string</code>                                   |
| **`request`**   | <code><a href="#restrequest">RestRequest</a></code>   |
| **`response`**  | <code><a href="#restresponse">RestResponse</a></code> |
| **`error`**     | <code>string</code>                                   |


#### RestRequest

| Prop                | Type                                                                        | Description                                                                |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **`id`**            | <code>string</code>                                                         |                                                                            |
| **`jobId`**         | <code>string</code>                                                         | Present only for async routes. Use it with `completeJob()` or `failJob()`. |
| **`method`**        | <code><a href="#restmethod">RestMethod</a></code>                           |                                                                            |
| **`path`**          | <code>string</code>                                                         |                                                                            |
| **`route`**         | <code>string</code>                                                         |                                                                            |
| **`params`**        | <code><a href="#record">Record</a>&lt;string, string&gt;</code>             |                                                                            |
| **`query`**         | <code><a href="#record">Record</a>&lt;string, string \| string[]&gt;</code> |                                                                            |
| **`headers`**       | <code><a href="#record">Record</a>&lt;string, string&gt;</code>             |                                                                            |
| **`body`**          | <code>unknown</code>                                                        |                                                                            |
| **`bodyType`**      | <code><a href="#bodytype">BodyType</a></code>                               |                                                                            |
| **`remoteAddress`** | <code>string</code>                                                         |                                                                            |
| **`receivedAt`**    | <code>string</code>                                                         |                                                                            |


#### RestResponse

| Prop           | Type                                                            | Description                             |
| -------------- | --------------------------------------------------------------- | --------------------------------------- |
| **`status`**   | <code>number</code>                                             | HTTP status code to send to the client. |
| **`headers`**  | <code><a href="#record">Record</a>&lt;string, string&gt;</code> |                                         |
| **`body`**     | <code>unknown</code>                                            |                                         |
| **`bodyType`** | <code><a href="#bodytype">BodyType</a></code>                   |                                         |


#### CompleteJobOptions

| Prop           | Type                                                  |
| -------------- | ----------------------------------------------------- |
| **`response`** | <code><a href="#restresponse">RestResponse</a></code> |


#### FailJobOptions

| Prop         | Type                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **`error`**  | <code>string</code>                                                                                            |
| **`status`** | <code><a href="#extract">Extract</a>&lt;<a href="#jobstatus">JobStatus</a>, 'failed' \| 'cancelled'&gt;</code> |


#### JobIdOptions

| Prop        | Type                |
| ----------- | ------------------- |
| **`jobId`** | <code>string</code> |


#### ListJobsResult

| Prop       | Type                   |
| ---------- | ---------------------- |
| **`jobs`** | <code>JobInfo[]</code> |


#### ListJobsOptions

| Prop         | Type                                            | Description                                                   |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| **`status`** | <code><a href="#jobstatus">JobStatus</a></code> | Optional status filter. Omit it to return every retained job. |


#### MockRequestOptions

| Prop                | Type                                                            |
| ------------------- | --------------------------------------------------------------- |
| **`method`**        | <code><a href="#restmethod">RestMethod</a></code>               |
| **`path`**          | <code>string</code>                                             |
| **`headers`**       | <code><a href="#record">Record</a>&lt;string, string&gt;</code> |
| **`body`**          | <code>unknown</code>                                            |
| **`bodyType`**      | <code><a href="#bodytype">BodyType</a></code>                   |
| **`remoteAddress`** | <code>string</code>                                             |


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |


#### RestServerEvent

| Prop       | Type                                              |
| ---------- | ------------------------------------------------- |
| **`info`** | <code><a href="#serverinfo">ServerInfo</a></code> |


#### RestServerErrorEvent

| Prop          | Type                |
| ------------- | ------------------- |
| **`message`** | <code>string</code> |
| **`code`**    | <code>string</code> |


#### JobUpdatedEvent

| Prop      | Type                                        |
| --------- | ------------------------------------------- |
| **`job`** | <code><a href="#jobinfo">JobInfo</a></code> |


### Type Aliases


#### RestMethod

<code>'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'</code>


#### AuthOptions

<code><a href="#bearerauthoptions">BearerAuthOptions</a> | <a href="#noauthoptions">NoAuthOptions</a></code>


#### PluginPlatform

The bridge implementation that actually handled the call - the cheapest way to confirm
whether a given platform is running its native server or falling back to the web mock.

<code>'ios' | 'android' | 'electron' | 'web'</code>


#### RouteMode

<code>'sync' | 'async'</code>


#### JobStatus

<code>'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'</code>


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>


#### BodyType

<code>'empty' | 'json' | 'text' | 'binary' | 'form' | 'multipart'</code>


#### Extract

<a href="#extract">Extract</a> from T those types that are assignable to U

<code>T extends U ? T : never</code>

</docgen-api>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
