import Capacitor
import NIOHTTP1

extension CapacitorREST {
    func isAuthorized(headers: HTTPHeaders) -> Bool {
        guard options.auth.type == "bearer" else {
            return true
        }
        return constantTimeEquals(headers.first(name: "authorization") ?? "", "Bearer \(options.auth.token ?? "")")
    }

    func isAuthorized(headers: JSObject) -> Bool {
        guard options.auth.type == "bearer" else {
            return true
        }
        return constantTimeEquals(headers["authorization"] as? String ?? "", "Bearer \(options.auth.token ?? "")")
    }

    /// Resolves and applies CORS headers for `requestOrigin`, or returns `payload` unchanged
    /// if the origin isn't allowed (in which case no CORS headers are sent and the browser
    /// blocks the cross-origin read). A comma-joined origin list is not valid header syntax,
    /// so an explicit allowlist is matched against the request's actual `Origin` header
    /// instead of being echoed back verbatim.
    func withCors(_ payload: ResponsePayload, origin requestOrigin: String?) -> ResponsePayload {
        guard options.cors.enabled else {
            return payload
        }
        guard let allowOrigin = resolveAllowOrigin(requestOrigin, cors: options.cors) else {
            return payload
        }
        var headers = payload.headers
        headers["access-control-allow-origin"] = allowOrigin
        headers["access-control-allow-methods"] = options.cors.methods.joined(separator: ",")
        headers["access-control-allow-headers"] = options.cors.headers.joined(separator: ",")
        headers["access-control-max-age"] = options.cors.maxAgeSeconds
        headers["vary"] = "Origin"
        if !options.cors.exposeHeaders.isEmpty {
            headers["access-control-expose-headers"] = options.cors.exposeHeaders.joined(separator: ",")
        }
        if options.cors.allowCredentials {
            headers["access-control-allow-credentials"] = "true"
        }
        return ResponsePayload(status: payload.status, headers: headers, body: payload.body, bodyType: payload.bodyType)
    }
}
