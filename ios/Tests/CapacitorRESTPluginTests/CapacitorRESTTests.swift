import XCTest
import Capacitor
@testable import CapacitorRESTPlugin

/// Unit tests for the plain implementation class, per PLUGIN_DEV.md - never against the CAPPlugin dispatcher.
class CapacitorRESTTests: XCTestCase {
    private var bridge: RecordingBridge!
    private var implementation: CapacitorREST!

    override func setUp() {
        super.setUp()
        bridge = RecordingBridge()
        implementation = CapacitorREST(bridge: bridge)
    }

    override func tearDown() {
        implementation.stop()
        implementation = nil
        bridge = nil
        super.tearDown()
    }

    @discardableResult
    private func startServer(_ options: JSObject = ["port": 0]) throws -> JSObject {
        try implementation.start(options: options)
    }

    func testStartResolvesARunningServerWithAResolvedPort() throws {
        let info = try startServer()
        XCTAssertEqual(info["running"] as? Bool, true)
        XCTAssertGreaterThan(info["port"] as? Int ?? 0, 0)
    }

    func testStopMarksTheServerAsNotRunning() throws {
        try startServer()
        implementation.stop()
        XCTAssertEqual(implementation.getInfo()["running"] as? Bool, false)
    }

    func testRegisterRouteNormalizesMethodAndPath() throws {
        try startServer()

        let route = try implementation.registerRoute(options: [
            "method": "get",
            "path": "orders/:id"
        ])

        XCTAssertEqual(route["method"] as? String, "GET")
        XCTAssertEqual(route["path"] as? String, "/orders/:id")
        XCTAssertEqual(route["mode"] as? String, "sync")
    }

    func testUnregisterRouteAndClearRoutesRemoveMatchingRoutes() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/orders/:id"])
        implementation.unregisterRoute(options: ["method": "GET", "path": "/orders/:id"])

        let notFound = try mockRequest(["method": "GET", "path": "/orders/1"])
        XCTAssertEqual(notFound["status"] as? Int, 404)

        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/other"])
        implementation.clearRoutes()
        let alsoNotFound = try mockRequest(["method": "GET", "path": "/other"])
        XCTAssertEqual(alsoNotFound["status"] as? Int, 404)
    }

    func testMockRequestResolvesRouteParamsThroughTheJSHandler() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/orders/:id"])
        bridge.onRequest = { [weak self] request in
            let params = request["params"] as? JSObject
            try? self?.implementation.respond(options: [
                "requestId": request["id"] as? String ?? "",
                "status": 200,
                "bodyType": "json",
                "body": ["id": params?["id"] as? String ?? ""]
            ])
        }

        let response = try mockRequest(["method": "GET", "path": "/orders/42"])
        XCTAssertEqual(response["status"] as? Int, 200)
        let body = response["body"] as? JSObject
        XCTAssertEqual(body?["id"] as? String, "42")
    }

    func testMockRequestReturns404ForAnUnmatchedRoute() throws {
        try startServer()
        let response = try mockRequest(["method": "GET", "path": "/nope"])
        XCTAssertEqual(response["status"] as? Int, 404)
    }

    func testMockRequestReturns401ForAMissingBearerToken() throws {
        try startServer(["port": 0, "auth": ["type": "bearer", "token": "secret"]])
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/protected"])

        let response = try mockRequest(["method": "GET", "path": "/protected"])
        XCTAssertEqual(response["status"] as? Int, 401)
    }

    func testMockRequestReturns413WhenBodyExceedsMaxBodySizeBytes() throws {
        try startServer(["port": 0, "maxBodySizeBytes": 4])
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/upload"])

        let response = try mockRequest([
            "method": "POST",
            "path": "/upload",
            "bodyType": "text",
            "body": "way too big"
        ])
        XCTAssertEqual(response["status"] as? Int, 413)
    }

    func testAsyncRouteReturns202ThenCompleteJobResolvesIt() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/imports", "mode": "async"])
        var jobId: String?
        bridge.onRequest = { request in jobId = request["jobId"] as? String }

        let response = try mockRequest(["method": "POST", "path": "/imports"])
        XCTAssertEqual(response["status"] as? Int, 202)
        XCTAssertNotNil(jobId)

        let completed = try implementation.completeJob(options: [
            "jobId": jobId ?? "",
            "response": ["status": 201, "bodyType": "json", "body": ["ok": true]]
        ])
        XCTAssertEqual(completed["status"] as? String, "completed")
        XCTAssertEqual(try implementation.getJob(options: ["jobId": jobId ?? ""])["jobId"] as? String, jobId)
    }

    func testFailJobMarksAJobFailedWithTheGivenError() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/imports", "mode": "async"])
        var jobId: String?
        bridge.onRequest = { request in jobId = request["jobId"] as? String }
        _ = try mockRequest(["method": "POST", "path": "/imports"])

        let failed = try implementation.failJob(options: ["jobId": jobId ?? "", "error": "boom"])
        XCTAssertEqual(failed["status"] as? String, "failed")
        XCTAssertEqual(failed["error"] as? String, "boom")
    }

    func testGetJobRejectsForAnUnknownJobId() throws {
        try startServer()
        XCTAssertThrowsError(try implementation.getJob(options: ["jobId": "missing"]))
    }

    func testListJobsAndDeleteJobManageRetainedJobs() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/imports", "mode": "async"])
        var jobId: String?
        bridge.onRequest = { request in jobId = request["jobId"] as? String }
        _ = try mockRequest(["method": "POST", "path": "/imports"])

        XCTAssertEqual((implementation.listJobs()["jobs"] as? [JSObject])?.count, 1)

        implementation.deleteJob(options: ["jobId": jobId ?? ""])
        XCTAssertEqual((implementation.listJobs()["jobs"] as? [JSObject])?.count, 0)
        XCTAssertThrowsError(try implementation.getJob(options: ["jobId": jobId ?? ""]))
    }

    func testRealHTTPResponseNeverDuplicatesTheContentLengthHeader() throws {
        let info = try startServer()
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/ping"])
        bridge.onRequest = { [weak self] request in
            try? self?.implementation.respond(options: [
                "requestId": request["id"] as? String ?? "",
                "status": 200,
                "bodyType": "json",
                "body": ["ok": true]
            ])
        }

        let port = info["port"] as? Int ?? 0
        let rawResponse = try sendRawHTTPGet(port: port, path: "/ping")
        let headerLines = rawResponse
            .components(separatedBy: "\r\n\r\n")[0]
            .components(separatedBy: "\r\n")
        let contentLengthLines = headerLines.filter { $0.lowercased().hasPrefix("content-length:") }

        XCTAssertTrue(headerLines.first?.contains("200") ?? false)
        // HTTPURLResponse/Dictionary can't represent a duplicated header name, so this reads the
        // raw socket bytes directly - the only way to actually catch a regression of the
        // duplicate-Content-Length bug this guards against.
        XCTAssertEqual(contentLengthLines.count, 1)
    }

    func testAFinishedJobCannotBeCompletedOrFailedAgain() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/imports", "mode": "async"])
        var jobId: String?
        bridge.onRequest = { request in jobId = request["jobId"] as? String }
        _ = try mockRequest(["method": "POST", "path": "/imports"])

        _ = try implementation.failJob(options: ["jobId": jobId ?? "", "status": "cancelled", "error": "stop"])
        XCTAssertThrowsError(try implementation.completeJob(options: ["jobId": jobId ?? "", "response": ["status": 200]]))
        XCTAssertThrowsError(try implementation.failJob(options: ["jobId": jobId ?? "", "error": "again"]))
        XCTAssertEqual(try implementation.getJob(options: ["jobId": jobId ?? ""])["status"] as? String, "cancelled")
    }

    func testFailJobRejectsAStatusOtherThanFailedOrCancelled() throws {
        try startServer()
        _ = try implementation.registerRoute(options: ["method": "POST", "path": "/imports", "mode": "async"])
        var jobId: String?
        bridge.onRequest = { request in jobId = request["jobId"] as? String }
        _ = try mockRequest(["method": "POST", "path": "/imports"])

        XCTAssertThrowsError(try implementation.failJob(options: ["jobId": jobId ?? "", "status": "completed", "error": "x"]))
    }

    func testHandlerSuppliedContentLengthIsReplacedByTheRealBodyLength() throws {
        let info = try startServer()
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/ping"])
        bridge.onRequest = { [weak self] request in
            try? self?.implementation.respond(options: [
                "requestId": request["id"] as? String ?? "",
                "status": 200,
                "headers": ["content-length": "3"],
                "bodyType": "text",
                "body": "hello"
            ])
        }

        let rawResponse = try sendRawHTTPGet(port: info["port"] as? Int ?? 0, path: "/ping")
        let headerLines = rawResponse.components(separatedBy: "\r\n\r\n")[0].components(separatedBy: "\r\n")
        let contentLengths = headerLines.filter { $0.lowercased().hasPrefix("content-length:") }
        XCTAssertEqual(contentLengths.count, 1)
        XCTAssertTrue(contentLengths[0].hasSuffix(" 5"))
        XCTAssertTrue(rawResponse.hasSuffix("hello"))
    }

    func testStopAnswersAnInFlightRequestWith503() throws {
        let info = try startServer()
        _ = try implementation.registerRoute(options: ["method": "GET", "path": "/slow"])
        let requestArrived = expectation(description: "request reached JS")
        bridge.onRequest = { _ in requestArrived.fulfill() }

        let port = info["port"] as? Int ?? 0
        var raw = ""
        let finished = expectation(description: "client finished")
        DispatchQueue.global().async {
            raw = (try? self.sendRawHTTPGet(port: port, path: "/slow")) ?? ""
            finished.fulfill()
        }
        wait(for: [requestArrived], timeout: 5)
        implementation.stop()
        wait(for: [finished], timeout: 5)
        XCTAssertTrue(raw.hasPrefix("HTTP/1.1 503") || raw.isEmpty, "unexpected response: \(raw)")
        XCTAssertEqual(implementation.getInfo()["running"] as? Bool, false)
    }

    /// Opens a raw TCP socket and issues a plain HTTP/1.1 GET, returning the raw response text.
    /// `URLSession`/`HTTPURLResponse` normalize headers into a `Dictionary`, which cannot
    /// represent a duplicated header name - a raw socket read is the only way to see that.
    private func sendRawHTTPGet(port: Int, path: String) throws -> String {
        let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(socketDescriptor) }
        XCTAssertGreaterThanOrEqual(socketDescriptor, 0)

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")

        let connectResult = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                connect(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        XCTAssertEqual(connectResult, 0)

        let request = "GET \(path) HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        _ = request.withCString { send(socketDescriptor, $0, strlen($0), 0) }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let bytesRead = read(socketDescriptor, &buffer, buffer.count)
            if bytesRead <= 0 {
                break
            }
            data.append(contentsOf: buffer[0..<bytesRead])
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Drives `mockRequest`'s completion-handler API synchronously for straight-line test bodies.
    private func mockRequest(_ options: JSObject) throws -> JSObject {
        var result: Result<JSObject, Error>?
        let expectation = expectation(description: "mockRequest")
        implementation.mockRequest(options: options) {
            result = $0
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 5)
        switch try XCTUnwrap(result) {
        case .success(let response): return response
        case .failure(let error): throw error
        }
    }
}

private final class RecordingBridge: RestServerBridge {
    var onRequest: ((JSObject) -> Void)?

    func emit(_ eventName: String, _ payload: JSObject) {
        if eventName == "request" {
            onRequest?(payload)
        }
    }
}
