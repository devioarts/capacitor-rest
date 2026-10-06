# Changelog

## [Unreleased]

### Fixed
- Electron: `respond()` with a malformed response no longer leaves the HTTP request (and `stop()`) hanging; a failed `start()` no longer reports `running: true`; `stop()` force-closes stuck connections; events are tracked per window and forgotten after a reload; `mockRequest()` rejects while stopped.
- Android: `stop()` releases in-flight requests before shutting the engine down and runs off the shared plugin thread; `start()`/`stop()` are serialized; port `0` is read back from the bound engine; client cancellation is no longer reported as a timeout; `dispose()` clears jobs and routes.
- iOS: the 30s idle timeout no longer cuts off slow synchronous responses; `start()`/`stop()` are serialized and the server stops when the plugin is released; a socket closed while the app was suspended is reported instead of `running: true`.
- All platforms: finished jobs can no longer be completed/failed again, `failJob()` validates `status`, and a handler-supplied `Content-Length` is replaced by the real body length.
- Lint: ESLint works again with TypeScript 7 (typescript-eslint runs from `lint/` with TypeScript 6) and runs in CI.

## [0.0.1] - 2026-07-11

### Added
- Initial release: cross-platform embedded REST server (Web mock, Android/Ktor, iOS/SwiftNIO, Electron/Node) with routing, path params, wildcards, CORS, bearer auth, body-size limits, and a sync/async job model.

### Fixed
- Hardened CORS header application, request-body-size/auth ordering, thread-safety of shared server state, job retention limits, and connection shutdown across all four platforms, based on an internal pre-release audit.
