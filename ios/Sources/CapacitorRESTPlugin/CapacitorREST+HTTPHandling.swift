import Capacitor
import Foundation
import NIO
import NIOHTTP1

extension CapacitorREST {
    var maxBodySizeBytes: Int {
        options.maxBodySizeBytes
    }

    func handle(head: HTTPRequestHead, body: ByteBuffer, remoteAddress: String?, on eventLoop: EventLoop) -> EventLoopFuture<ResponsePayload> {
        let method = normalizeMethod(head.method.rawValue)
        let components = URLComponents(string: head.uri)
        let path = normalizePath(components?.path ?? "/")
        let requestOrigin = head.headers.first(name: "origin")

        if method == "OPTIONS" {
            return eventLoop.makeSucceededFuture(withCors(ResponsePayload(status: 204, bodyType: "empty"), origin: requestOrigin))
        }

        if !isAuthorized(headers: head.headers) {
            return eventLoop.makeSucceededFuture(withCors(ResponsePayload(status: 401, body: ["error": "Unauthorized"], bodyType: "json"), origin: requestOrigin))
        }

        if let systemResponse = trySystemRoute(method: method, path: path, queryItems: components?.queryItems ?? []) {
            return eventLoop.makeSucceededFuture(withCors(systemResponse, origin: requestOrigin))
        }

        guard let match = matchRoute(method: method, path: path) else {
            return eventLoop.makeSucceededFuture(withCors(ResponsePayload(status: 404, body: ["error": "Route not found"], bodyType: "json"), origin: requestOrigin))
        }

        let request = buildRequest(
            head: head,
            body: body,
            path: path,
            route: match.route,
            params: match.params,
            queryItems: components?.queryItems ?? [],
            remoteAddress: remoteAddress
        )

        if match.route.mode == "async" {
            let job = createJob(request)
            bridge?.emit("request", job.request ?? request)
            return eventLoop.makeSucceededFuture(withCors(
                ResponsePayload(
                    status: 202,
                    headers: ["location": "/__jobs/\(job.jobId)"],
                    body: ["jobId": job.jobId, "status": job.status, "location": "/__jobs/\(job.jobId)"],
                    bodyType: "json"
                ),
                origin: requestOrigin
            ))
        }

        let promise = eventLoop.makePromise(of: ResponsePayload.self)
        let requestId = request["id"] as? String ?? UUID().uuidString
        let timeout = match.route.timeoutMs ?? options.requestTimeoutMs

        // Cancellable (unlike a bare asyncAfter closure) so a request that completes normally
        // doesn't leave a dead timer scheduled - mirrors the pattern in mockRequest().
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
        pending[requestId] = PendingResponse(promise: promise)
        lock.unlock()
        bridge?.emit("request", request)
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout / 1000, execute: timeoutTask)

        return promise.futureResult.map { [weak self] payload in
            timeoutTask.cancel()
            return self?.withCors(payload, origin: requestOrigin) ?? payload
        }
    }

    private func buildRequest(
        head: HTTPRequestHead,
        body: ByteBuffer,
        path: String,
        route: RouteRecord,
        params: JSObject,
        queryItems: [URLQueryItem],
        remoteAddress: String?
    ) -> JSObject {
        var bodyBuffer = body
        let bytes = bodyBuffer.readBytes(length: bodyBuffer.readableBytes) ?? []
        let bodyType = inferBodyType(contentType: head.headers.first(name: "content-type"), bytes: bytes)
        var request: JSObject = [
            "id": UUID().uuidString,
            "method": route.method,
            "path": path,
            "route": route.path,
            "params": params,
            "query": parseQuery(queryItems),
            "headers": parseHeaders(head.headers),
            "bodyType": bodyType,
            "receivedAt": now()
        ]
        request["body"] = toJSValue(parseBody(bytes: bytes, bodyType: bodyType))
        if let remoteAddress {
            request["remoteAddress"] = remoteAddress
        }
        return request
    }
}
