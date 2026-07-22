# Changelog

## [0.0.1] - 2026-07-11

### Added
- Initial release: cross-platform embedded REST server (Web mock, Android/Ktor, iOS/SwiftNIO, Electron/Node) with routing, path params, wildcards, CORS, bearer auth, body-size limits, and a sync/async job model.

### Fixed
- Hardened CORS header application, request-body-size/auth ordering, thread-safety of shared server state, job retention limits, and connection shutdown across all four platforms, based on an internal pre-release audit.
