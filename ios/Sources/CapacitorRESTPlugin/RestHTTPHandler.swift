import NIO
import NIOHTTP1

final class RestHTTPHandler: ChannelInboundHandler {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart

    /// Maximum time to wait for a client to finish sending a request. Without this, a
    /// connection that opens but never completes its headers/body (accidentally or as a
    /// slow-loris style attack) would hold the socket and its event loop resources open
    /// indefinitely, since `configureHTTPServerPipeline()` does not add a read timeout itself.
    private static let idleTimeout: TimeAmount = .seconds(30)

    private let server: CapacitorREST
    private var head: HTTPRequestHead?
    private var body = ByteBufferAllocator().buffer(capacity: 0)
    private var bodyTooLarge = false
    private var idleTask: Scheduled<Void>?

    init(server: CapacitorREST) {
        self.server = server
    }

    func channelActive(context: ChannelHandlerContext) {
        scheduleIdleTimeout(context: context)
        context.fireChannelActive()
    }

    func channelInactive(context: ChannelHandlerContext) {
        idleTask?.cancel()
        context.fireChannelInactive()
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        idleTask?.cancel()
        scheduleIdleTimeout(context: context)
        switch unwrapInboundIn(data) {
        case .head(let head):
            self.head = head
            body.clear()
            bodyTooLarge = false
        case .body(var part):
            if bodyTooLarge {
                return
            }
            if body.readableBytes + part.readableBytes > server.maxBodySizeBytes {
                body.clear()
                bodyTooLarge = true
                write(context: context, payload: ResponsePayload(status: 413, body: ["error": "Payload too large"], bodyType: "json"))
                return
            }
            body.writeBuffer(&part)
        case .end:
            if bodyTooLarge {
                return
            }
            guard let head else {
                write(context: context, payload: ResponsePayload(status: 400, body: ["error": "Invalid request"], bodyType: "json"))
                return
            }
            let remoteAddress = context.channel.remoteAddress?.ipAddress
            server.handle(head: head, body: body, remoteAddress: remoteAddress, on: context.eventLoop).whenComplete { result in
                switch result {
                case .success(let payload):
                    self.write(context: context, payload: payload)
                case .failure(let error):
                    self.write(context: context, payload: ResponsePayload(status: 500, body: ["error": error.localizedDescription], bodyType: "json"))
                }
            }
        }
    }

    private func scheduleIdleTimeout(context: ChannelHandlerContext) {
        idleTask = context.eventLoop.scheduleTask(in: Self.idleTimeout) {
            context.close(promise: nil)
        }
    }

    private func write(context: ChannelHandlerContext, payload: ResponsePayload) {
        idleTask?.cancel()
        var headers = HTTPHeaders()
        payload.headers.forEach { key, value in
            headers.add(name: key, value: "\(value)")
        }
        let bytes = payload.bodyBytes()
        // Guard both headers the same way: if the handler already supplied its own value,
        // adding the computed one too would produce two conflicting header lines (HTTPHeaders
        // permits duplicate names), which is invalid per RFC 7230 §3.3.2 for Content-Length.
        if headers.first(name: "content-length") == nil {
            headers.add(name: "content-length", value: "\(bytes.count)")
        }
        if headers.first(name: "content-type") == nil, let contentType = payload.contentType {
            headers.add(name: "content-type", value: contentType)
        }

        let status = HTTPResponseStatus(statusCode: payload.status)
        let head = HTTPResponseHead(version: .http1_1, status: status, headers: headers)
        context.write(wrapOutboundOut(.head(head)), promise: nil)
        if !bytes.isEmpty {
            var buffer = context.channel.allocator.buffer(capacity: bytes.count)
            buffer.writeBytes(bytes)
            context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
        }
        // No HTTP keep-alive: every response closes the connection, even for a client that sent
        // `Connection: keep-alive`. Deliberate for simplicity given this server's typical
        // request volume, but worth knowing before "fixing" the idle-timeout interaction above
        // without also revisiting this.
        context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in
            context.close(promise: nil)
        }
    }
}
