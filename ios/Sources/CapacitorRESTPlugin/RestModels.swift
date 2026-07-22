import Foundation
import Capacitor
import NIO

struct ServerOptions {
    let host: String
    let port: Int
    let requestTimeoutMs: Double
    let jobRetentionMs: Double
    let maxBodySizeBytes: Int
    let maxRetainedJobs: Int
    let auth: AuthOptions
    let cors: CorsOptions

    init(
        host: String = "0.0.0.0",
        port: Int = 8080,
        requestTimeoutMs: Double = 30_000,
        jobRetentionMs: Double = 300_000,
        maxBodySizeBytes: Int = 10 * 1024 * 1024,
        maxRetainedJobs: Int = 1000,
        auth: AuthOptions = AuthOptions(type: "none", token: nil),
        cors: CorsOptions = CorsOptions()
    ) {
        self.host = host
        self.port = port
        self.requestTimeoutMs = requestTimeoutMs
        self.jobRetentionMs = jobRetentionMs
        self.maxBodySizeBytes = maxBodySizeBytes
        self.maxRetainedJobs = maxRetainedJobs
        self.auth = auth
        self.cors = cors
    }

    init(_ data: JSObject) throws {
        host = data["host"] as? String ?? "0.0.0.0"
        port = intValue(data["port"], defaultValue: 8080)
        requestTimeoutMs = doubleValue(data["requestTimeoutMs"], defaultValue: 30_000)
        jobRetentionMs = doubleValue(data["jobRetentionMs"], defaultValue: 300_000)
        maxBodySizeBytes = intValue(data["maxBodySizeBytes"], defaultValue: 10 * 1024 * 1024)
        maxRetainedJobs = intValue(data["maxRetainedJobs"], defaultValue: 1000)
        if let authData = data["auth"] as? JSObject {
            let type = authData["type"] as? String ?? "none"
            let token = authData["token"] as? String
            if type != "none" && type != "bearer" {
                throw RestError.message("auth.type must be 'none' or 'bearer'")
            }
            if type == "bearer" && (token?.isEmpty ?? true) {
                throw RestError.message("auth.token is required when auth.type is 'bearer'")
            }
            auth = AuthOptions(type: type, token: token)
        } else {
            auth = AuthOptions(type: "none", token: nil)
        }
        cors = CorsOptions(data["cors"] as? JSObject)
    }
}

struct AuthOptions {
    let type: String
    let token: String?
}

struct CorsOptions {
    let enabled: Bool
    let origins: [String]
    let methods: [String]
    let headers: [String]
    let exposeHeaders: [String]
    let allowCredentials: Bool
    let maxAgeSeconds: Int

    init(
        enabled: Bool = false,
        origins: [String] = ["*"],
        methods: [String] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        headers: [String] = ["authorization", "content-type"],
        exposeHeaders: [String] = [],
        allowCredentials: Bool = false,
        maxAgeSeconds: Int = 600
    ) {
        self.enabled = enabled
        self.origins = origins
        self.methods = methods
        self.headers = headers
        self.exposeHeaders = exposeHeaders
        self.allowCredentials = allowCredentials
        self.maxAgeSeconds = maxAgeSeconds
    }

    init(_ data: JSObject?) {
        enabled = data?["enabled"] as? Bool ?? false
        origins = data?["origins"] as? [String] ?? ["*"]
        methods = data?["methods"] as? [String] ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
        headers = data?["headers"] as? [String] ?? ["authorization", "content-type"]
        exposeHeaders = data?["exposeHeaders"] as? [String] ?? []
        allowCredentials = data?["allowCredentials"] as? Bool ?? false
        maxAgeSeconds = data?["maxAgeSeconds"] as? Int ?? 600
    }
}

/// Resolves the `Access-Control-Allow-Origin` value for a request, or `nil` if the
/// request's origin is not allowed.
func resolveAllowOrigin(_ requestOrigin: String?, cors: CorsOptions) -> String? {
    if cors.origins.contains("*") {
        if cors.allowCredentials, let requestOrigin {
            return requestOrigin
        }
        return "*"
    }
    if let requestOrigin, cors.origins.contains(requestOrigin) {
        return requestOrigin
    }
    return nil
}

struct RouteRecord {
    let method: String
    let path: String
    let mode: String
    let timeoutMs: Double?
    let segments: [String]

    func toJSObject() -> JSObject {
        var data: JSObject = [
            "method": method,
            "path": path,
            "mode": mode
        ]
        if let timeoutMs {
            data["timeoutMs"] = timeoutMs
        }
        return data
    }
}

struct RouteMatch {
    let route: RouteRecord
    let params: JSObject
}

struct JobRecord {
    let jobId: String
    let status: String
    let createdAt: String
    let updatedAt: String
    let request: JSObject?
    let response: ResponsePayload?
    let error: String?

    init(jobId: String, status: String, createdAt: String, updatedAt: String, request: JSObject?, response: ResponsePayload? = nil, error: String? = nil) {
        self.jobId = jobId
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.request = request
        self.response = response
        self.error = error
    }

    func completed(with response: ResponsePayload) -> JobRecord {
        JobRecord(jobId: jobId, status: "completed", createdAt: createdAt, updatedAt: now(), request: request, response: response)
    }

    func failed(status: String, error: String) -> JobRecord {
        JobRecord(jobId: jobId, status: status, createdAt: createdAt, updatedAt: now(), request: request, response: response, error: error)
    }

    func expired() -> JobRecord {
        JobRecord(jobId: jobId, status: "expired", createdAt: createdAt, updatedAt: now(), request: request, response: response, error: error)
    }

    func toJSObject() -> JSObject {
        var data: JSObject = [
            "jobId": jobId,
            "status": status,
            "createdAt": createdAt,
            "updatedAt": updatedAt
        ]
        if let request {
            data["request"] = request
        }
        if let response {
            data["response"] = response.toJSObject()
        }
        if let error {
            data["error"] = error
        }
        return data
    }
}

struct ResponsePayload {
    let status: Int
    let headers: JSObject
    let body: Any?
    let bodyType: String

    init(status: Int, headers: JSObject = [:], body: Any? = nil, bodyType: String = "empty") {
        self.status = status
        self.headers = headers
        self.body = body
        self.bodyType = bodyType
    }

    init(_ data: JSObject) {
        status = data["status"] as? Int ?? 200
        headers = data["headers"] as? JSObject ?? [:]
        body = data["body"]
        bodyType = data["bodyType"] as? String ?? inferBodyType(body)
    }

    var contentType: String? {
        switch bodyType {
        // No body means no representation to describe - e.g. a 204 response (OPTIONS preflight,
        // DELETE /__jobs/:id) shouldn't carry a spurious "application/json" Content-Type.
        case "empty": return nil
        case "binary": return "application/octet-stream"
        case "text": return "text/plain; charset=utf-8"
        default: return "application/json; charset=utf-8"
        }
    }

    func bodyBytes() -> [UInt8] {
        guard let body else {
            return []
        }
        switch bodyType {
        case "binary":
            if let string = body as? String, let data = Data(base64Encoded: string) {
                return Array(data)
            }
            return []
        case "text":
            return Array("\(body)".utf8)
        default:
            // `.fragmentsAllowed` permits a top-level JSON fragment (string/number/bool), not
            // just arrays/dictionaries, so primitive bodies serialize correctly.
            if let data = try? JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed]) {
                return Array(data)
            }
            // `body` isn't a JSON-representable value at all (e.g. a custom object bridged
            // from JS): serialize its description as a properly escaped JSON string rather
            // than interpolating it into a hand-built literal, which would emit invalid JSON
            // for any value containing a quote or backslash.
            if let data = try? JSONSerialization.data(withJSONObject: String(describing: body), options: [.fragmentsAllowed]) {
                return Array(data)
            }
            return Array("null".utf8)
        }
    }

    func toJSObject() -> JSObject {
        var data: JSObject = [
            "status": status,
            "headers": headers,
            "bodyType": bodyType
        ]
        data["body"] = toJSValue(body)
        return data
    }
}

enum RestError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        }
    }
}

final class PendingResponse {
    private let completion: (ResponsePayload) -> Void

    init(promise: EventLoopPromise<ResponsePayload>) {
        completion = { payload in
            promise.succeed(payload)
        }
    }

    init(_ completion: @escaping (ResponsePayload) -> Void) {
        self.completion = completion
    }

    func complete(_ payload: ResponsePayload) {
        completion(payload)
    }
}
