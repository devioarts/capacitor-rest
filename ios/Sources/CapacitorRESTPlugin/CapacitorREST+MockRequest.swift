import Capacitor
import Foundation

extension CapacitorREST {
    func mockRequest(options data: JSObject, completion: @escaping (Result<JSObject, Error>) -> Void) {
        guard channel != nil else {
            completion(.failure(RestError.message("Server is not running")))
            return
        }

        let method = normalizeMethod(data["method"] as? String ?? "GET")
        let components = URLComponents(string: data["path"] as? String ?? "/")
        let path = normalizePath(components?.path ?? "/")
        let headers = normalizeHeaders(data["headers"] as? JSObject ?? [:])
        let requestOrigin = headers["origin"] as? String
        let body = data["body"]
        let bodyType = data["bodyType"] as? String ?? inferBodyType(body)

        if estimateBodySize(body, bodyType: bodyType) > options.maxBodySizeBytes {
            completion(.success(withCors(ResponsePayload(status: 413, body: ["error": "Payload too large"], bodyType: "json"), origin: requestOrigin).toJSObject()))
            return
        }

        if method == "OPTIONS" {
            completion(.success(withCors(ResponsePayload(status: 204, bodyType: "empty"), origin: requestOrigin).toJSObject()))
            return
        }

        if !isAuthorized(headers: headers) {
            completion(.success(withCors(ResponsePayload(status: 401, body: ["error": "Unauthorized"], bodyType: "json"), origin: requestOrigin).toJSObject()))
            return
        }

        if let systemResponse = trySystemRoute(method: method, path: path, queryItems: components?.queryItems ?? []) {
            completion(.success(withCors(systemResponse, origin: requestOrigin).toJSObject()))
            return
        }

        guard let match = matchRoute(method: method, path: path) else {
            completion(.success(withCors(ResponsePayload(status: 404, body: ["error": "Route not found"], bodyType: "json"), origin: requestOrigin).toJSObject()))
            return
        }

        var request: JSObject = [
            "id": UUID().uuidString,
            "method": match.route.method,
            "path": path,
            "route": match.route.path,
            "params": match.params,
            "query": parseQuery(components?.queryItems ?? []),
            "headers": headers,
            "bodyType": bodyType,
            "body": toJSValue(body),
            "receivedAt": now()
        ]
        if let remoteAddress = data["remoteAddress"] as? String {
            request["remoteAddress"] = remoteAddress
        }

        if match.route.mode == "async" {
            let job = createJob(request)
            bridge?.emit("request", job.request ?? request)
            completion(.success(withCors(
                ResponsePayload(
                    status: 202,
                    headers: ["location": "/__jobs/\(job.jobId)"],
                    body: ["jobId": job.jobId, "status": job.status, "location": "/__jobs/\(job.jobId)"],
                    bodyType: "json"
                ),
                origin: requestOrigin
            ).toJSObject()))
            return
        }

        let requestId = request["id"] as? String ?? UUID().uuidString
        let timeout = match.route.timeoutMs ?? options.requestTimeoutMs
        let timeoutTask = DispatchWorkItem { [weak self] in
            guard let self else {
                return
            }
            self.lock.lock()
            let pendingResponse = self.pending.removeValue(forKey: requestId)
            self.lock.unlock()
            pendingResponse?.complete(
                ResponsePayload(status: 504, body: ["error": "Request \(requestId) timed out"], bodyType: "json")
            )
        }

        lock.lock()
        pending[requestId] = PendingResponse { [weak self] payload in
            timeoutTask.cancel()
            completion(.success(self?.withCors(payload, origin: requestOrigin).toJSObject() ?? payload.toJSObject()))
        }
        lock.unlock()
        bridge?.emit("request", request)
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout / 1000, execute: timeoutTask)
    }
}
