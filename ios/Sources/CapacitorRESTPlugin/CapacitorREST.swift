import Foundation
import Capacitor
import NIO
import NIOPosix

protocol RestServerBridge: AnyObject {
    func emit(_ eventName: String, _ payload: JSObject)
}

final class CapacitorREST {
    weak var bridge: RestServerBridge?
    var routes: [String: RouteRecord] = [:]
    // Registration order for `routes`, since Dictionary iteration order is unspecified - if two
    // registered routes could both match the same request (e.g. `/users/:id` and `/users/me`),
    // matchRoute() needs a deterministic tie-break (first registered wins) rather than whatever
    // order Dictionary's hashing happens to produce, which can change between runs.
    private var routeOrder: [String] = []
    var pending: [String: PendingResponse] = [:]
    var jobs: [String: JobRecord] = [:]
    let lock = NSLock()
    // start()/stop() block on NIO shutdown and must not interleave (start() calls stop() itself,
    // hence recursive): two overlapping calls could otherwise leave a bound socket or event-loop
    // threads that nothing references any more.
    private let lifecycleLock = NSRecursiveLock()

    // `channel`/`group` are written by start()/stop() and read (existence-checked) from
    // mockRequest()/getInfo(), which can run concurrently with a stop() in progress. Guarded by
    // a dedicated lock (separate from `lock` above) so a brief read never has to wait on
    // stop()'s blocking `.wait()` calls, and so there's no nesting/deadlock risk with the
    // routes/pending/jobs critical sections.
    private let channelLock = NSLock()
    private var _group: MultiThreadedEventLoopGroup?
    private var _channel: Channel?
    var channel: Channel? {
        get { channelLock.lock(); defer { channelLock.unlock() }; return _channel }
        set { channelLock.lock(); defer { channelLock.unlock() }; _channel = newValue }
    }
    private var group: MultiThreadedEventLoopGroup? {
        get { channelLock.lock(); defer { channelLock.unlock() }; return _group }
        set { channelLock.lock(); defer { channelLock.unlock() }; _group = newValue }
    }

    // Accepted (child) connections, tracked separately from the listening `channel` above.
    // `bootstrap.bind(...).wait()` only returns the listening socket - without tracking the
    // sockets it accepts, stop() had no way to close connections that were already open (e.g.
    // idle-but-not-yet-timed-out, or mid-request) when it ran, so they kept being served by
    // their RestHTTPHandler for up to its 30s idle timeout after "stopped" had already fired.
    private var childChannels: [ObjectIdentifier: Channel] = [:]

    // `options` is written by start()/stop() and read concurrently from NIO's event-loop
    // threads while handling in-flight requests. Unlike `routes`/`pending`/`jobs` (guarded by
    // `lock` above), it used to be a plain, unsynchronized `var`. Routing every access through
    // a dedicated lock (separate from `lock` to avoid any nesting/deadlock risk with the
    // existing routes/pending/jobs critical sections) keeps every call site unchanged while
    // making reads/writes of the options snapshot thread-safe.
    private let optionsLock = NSLock()
    private var _options = ServerOptions()
    var options: ServerOptions {
        get {
            optionsLock.lock()
            defer { optionsLock.unlock() }
            return _options
        }
        set {
            optionsLock.lock()
            defer { optionsLock.unlock() }
            _options = newValue
        }
    }

    init(bridge: RestServerBridge) {
        self.bridge = bridge
    }

    func start(options data: JSObject) throws -> JSObject {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        stop()
        options = try ServerOptions(data)
        let group = MultiThreadedEventLoopGroup(numberOfThreads: System.coreCount)
        // Published before binding so that a concurrent teardown can always find and shut it down.
        self.group = group
        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 256)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { [weak self] channel in
                guard let self else {
                    return channel.eventLoop.makeSucceededFuture(())
                }
                self.trackChildChannel(channel)
                return channel.pipeline.configureHTTPServerPipeline().flatMap {
                    channel.pipeline.addHandler(RestHTTPHandler(server: self))
                }
            }
            .childChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)

        do {
            channel = try bootstrap.bind(host: options.host, port: options.port).wait()
        } catch {
            try? group.syncShutdownGracefully()
            self.group = nil
            throw error
        }
        let info = getInfo()
        bridge?.emit("started", ["info": info])
        return info
    }

    private func trackChildChannel(_ channel: Channel) {
        channelLock.lock()
        childChannels[ObjectIdentifier(channel)] = channel
        channelLock.unlock()
        channel.closeFuture.whenComplete { [weak self] _ in
            guard let self else { return }
            self.channelLock.lock()
            self.childChannels.removeValue(forKey: ObjectIdentifier(channel))
            self.channelLock.unlock()
        }
    }

    func stop() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        lock.lock()
        let pendingResponses = pending
        pending.removeAll()
        lock.unlock()

        for (_, pendingResponse) in pendingResponses {
            pendingResponse.complete(ResponsePayload(status: 503, body: ["error": "Server stopped"], bodyType: "json"))
        }

        channelLock.lock()
        let openChildChannels = Array(childChannels.values)
        childChannels.removeAll()
        channelLock.unlock()
        // Close already-accepted connections too, not just the listening socket - otherwise a
        // connection open (idle or mid-request) at stop() time keeps being served for up to the
        // idle timeout, even after the "stopped" event has already fired.
        for childChannel in openChildChannels {
            try? childChannel.close().wait()
        }

        try? channel?.close().wait()
        channel = nil
        try? group?.syncShutdownGracefully()
        group = nil
        bridge?.emit("stopped", ["info": getInfo()])
    }

    /// Called when the app returns to the foreground. iOS can tear down listening sockets while the
    /// app is suspended; if that happened, report it instead of claiming the server is still up.
    func reconcileAfterForeground() {
        guard let current = channel, !current.isActive else {
            return
        }
        stop()
        bridge?.emit("error", ["message": "The server socket was closed while the app was in the background. Call start() again."])
    }

    func getInfo() -> JSObject {
        let running = channel?.isActive ?? false
        let port = channel?.localAddress?.port ?? options.port
        return [
            "running": running,
            "host": options.host,
            "port": running ? port : 0,
            "urls": running ? discoverLanUrls(port: port) : [],
            "mock": false
        ]
    }

    func registerRoute(options data: JSObject) throws -> JSObject {
        guard let method = data["method"] as? String else {
            throw RestError.message("method is required")
        }
        guard let path = data["path"] as? String else {
            throw RestError.message("path is required")
        }
        let route = RouteRecord(
            method: normalizeMethod(method),
            path: normalizePath(path),
            mode: data["mode"] as? String ?? "sync",
            timeoutMs: optionalDoubleValue(data["timeoutMs"]),
            segments: pathSegments(path)
        )
        let key = routeKey(route.method, route.path)
        lock.lock()
        if routes[key] == nil {
            routeOrder.append(key)
        }
        routes[key] = route
        lock.unlock()
        return route.toJSObject()
    }

    func unregisterRoute(options data: JSObject) {
        guard let method = data["method"] as? String, let path = data["path"] as? String else {
            return
        }
        let key = routeKey(method, path)
        lock.lock()
        routes.removeValue(forKey: key)
        routeOrder.removeAll { $0 == key }
        lock.unlock()
    }

    func clearRoutes() {
        lock.lock()
        routes.removeAll()
        routeOrder.removeAll()
        lock.unlock()
    }

    /// Routes in registration order, for deterministic first-match-wins resolution (see the
    /// `routeOrder` comment above `routes`). Call sites must not hold `lock` when calling this.
    func orderedRoutes() -> [RouteRecord] {
        lock.lock()
        defer { lock.unlock() }
        return routeOrder.compactMap { routes[$0] }
    }

    func respond(options data: JSObject) throws {
        guard let requestId = data["requestId"] as? String else {
            throw RestError.message("requestId is required")
        }
        lock.lock()
        let pendingResponse = pending.removeValue(forKey: requestId)
        lock.unlock()
        guard let pendingResponse else {
            throw RestError.message("Request \(requestId) is not pending")
        }
        pendingResponse.complete(ResponsePayload(data))
    }

    func completeJob(options data: JSObject) throws -> JSObject {
        guard let jobId = data["jobId"] as? String else {
            throw RestError.message("jobId is required")
        }
        guard let responseData = data["response"] as? JSObject else {
            throw RestError.message("response is required")
        }
        lock.lock()
        guard let job = jobs[jobId] else {
            lock.unlock()
            throw RestError.message("Job \(jobId) was not found")
        }
        guard job.status == "queued" || job.status == "running" else {
            lock.unlock()
            throw RestError.message("Job \(jobId) is already \(job.status)")
        }
        let updated = job.completed(with: ResponsePayload(responseData))
        jobs[jobId] = updated
        enforceJobRetentionCapLocked()
        lock.unlock()
        emitJobUpdated(updated)
        return updated.toJSObject()
    }

    func failJob(options data: JSObject) throws -> JSObject {
        guard let jobId = data["jobId"] as? String else {
            throw RestError.message("jobId is required")
        }
        let status = data["status"] as? String ?? "failed"
        guard status == "failed" || status == "cancelled" else {
            throw RestError.message("status must be 'failed' or 'cancelled'")
        }
        lock.lock()
        guard let job = jobs[jobId] else {
            lock.unlock()
            throw RestError.message("Job \(jobId) was not found")
        }
        guard job.status == "queued" || job.status == "running" else {
            lock.unlock()
            throw RestError.message("Job \(jobId) is already \(job.status)")
        }
        let updated = job.failed(
            status: status,
            error: data["error"] as? String ?? "Job failed"
        )
        jobs[jobId] = updated
        enforceJobRetentionCapLocked()
        lock.unlock()
        emitJobUpdated(updated)
        return updated.toJSObject()
    }

    func getJob(options data: JSObject) throws -> JSObject {
        guard let jobId = data["jobId"] as? String else {
            throw RestError.message("jobId is required")
        }
        lock.lock()
        let job = jobs[jobId]
        lock.unlock()
        guard let job else {
            throw RestError.message("Job \(jobId) was not found")
        }
        return job.toJSObject()
    }

    func listJobs(options data: JSObject = [:]) -> JSObject {
        listJobs(status: normalizeOptionalJobStatus(data["status"] as? String))
    }

    func deleteJob(options data: JSObject) {
        guard let jobId = data["jobId"] as? String else {
            return
        }
        lock.lock()
        jobs.removeValue(forKey: jobId)
        lock.unlock()
    }
}
