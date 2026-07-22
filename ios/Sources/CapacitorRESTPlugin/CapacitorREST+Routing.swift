import Capacitor
import Foundation

extension CapacitorREST {
    func trySystemRoute(method: String, path: String, queryItems: [URLQueryItem] = []) -> ResponsePayload? {
        if path == "/__jobs" {
            guard method == "GET" else {
                return ResponsePayload(status: 405, body: ["error": "Method not allowed"], bodyType: "json")
            }
            return ResponsePayload(
                status: 200,
                body: listJobs(status: normalizeOptionalJobStatus(queryItems.first { $0.name == "status" }?.value)),
                bodyType: "json"
            )
        }

        guard let match = path.range(of: #"^/__jobs/([^/]+)$"#, options: .regularExpression) else {
            return nil
        }
        let jobId = String(path[match]).replacingOccurrences(of: "/__jobs/", with: "").removingPercentEncoding ?? ""
        switch method {
        case "GET":
            lock.lock()
            let job = jobs[jobId]
            lock.unlock()
            if let job {
                return ResponsePayload(status: 200, body: job.toJSObject(), bodyType: "json")
            }
            return ResponsePayload(status: 404, body: ["error": "Job not found"], bodyType: "json")
        case "DELETE":
            lock.lock()
            jobs.removeValue(forKey: jobId)
            lock.unlock()
            return ResponsePayload(status: 204, bodyType: "empty")
        default:
            return ResponsePayload(status: 405, body: ["error": "Method not allowed"], bodyType: "json")
        }
    }

    func matchRoute(method: String, path: String) -> RouteMatch? {
        let requestSegments = pathSegments(path)
        for route in orderedRoutes() where route.method == method {
            if let params = matchSegments(route.segments, requestSegments) {
                return RouteMatch(route: route, params: params)
            }
        }
        return nil
    }
}
