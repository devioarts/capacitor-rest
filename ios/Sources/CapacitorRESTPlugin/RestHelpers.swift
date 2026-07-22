import Foundation
import Capacitor
import NIOHTTP1

/// Constant-time string comparison so bearer token checks don't leak timing information
/// through early-exit comparison of mismatched bytes.
func constantTimeEquals(_ lhs: String, _ rhs: String) -> Bool {
    let bytesLhs = Array(lhs.utf8)
    let bytesRhs = Array(rhs.utf8)
    let maxLength = max(bytesLhs.count, bytesRhs.count)
    var diff: UInt8 = bytesLhs.count == bytesRhs.count ? 0 : 1
    for index in 0..<maxLength {
        let byteLhs = index < bytesLhs.count ? bytesLhs[index] : 0
        let byteRhs = index < bytesRhs.count ? bytesRhs[index] : 0
        diff |= byteLhs ^ byteRhs
    }
    return diff == 0
}

func normalizeMethod(_ method: String) -> String {
    method.uppercased()
}

func normalizePath(_ path: String) -> String {
    path.hasPrefix("/") ? path : "/\(path)"
}

func routeKey(_ method: String, _ path: String) -> String {
    "\(normalizeMethod(method)) \(normalizePath(path))"
}

func pathSegments(_ path: String) -> [String] {
    normalizePath(path).split(separator: "/").map(String.init)
}

func matchSegments(_ routeSegments: [String], _ requestSegments: [String]) -> JSObject? {
    var params: JSObject = [:]
    for index in routeSegments.indices {
        let routeSegment = routeSegments[index]
        guard requestSegments.indices.contains(index) else {
            return nil
        }
        let requestSegment = requestSegments[index]
        if routeSegment == "*" {
            params["*"] = requestSegments.dropFirst(index).joined(separator: "/")
            return params
        }
        if routeSegment.hasPrefix(":") {
            params[String(routeSegment.dropFirst())] = requestSegment.removingPercentEncoding ?? requestSegment
            continue
        }
        if routeSegment != requestSegment {
            return nil
        }
    }
    return routeSegments.count == requestSegments.count ? params : nil
}

func parseHeaders(_ headers: HTTPHeaders) -> JSObject {
    var data: JSObject = [:]
    for header in headers {
        data[header.name.lowercased()] = header.value
    }
    return data
}

func normalizeHeaders(_ headers: JSObject) -> JSObject {
    var normalized: JSObject = [:]
    for (key, value) in headers {
        normalized[key.lowercased()] = value as? String ?? "\(value)"
    }
    return normalized
}

func parseQuery(_ queryItems: [URLQueryItem]) -> JSObject {
    var data: JSObject = [:]
    for item in queryItems {
        if let existing = data[item.name] as? [String] {
            data[item.name] = existing + [item.value ?? ""]
        } else if let existing = data[item.name] as? String {
            data[item.name] = [existing, item.value ?? ""]
        } else {
            data[item.name] = item.value ?? ""
        }
    }
    return data
}

func parseBody(bytes: [UInt8], bodyType: String) -> Any? {
    guard !bytes.isEmpty else {
        return nil
    }
    let data = Data(bytes)
    switch bodyType {
    case "json":
        return (try? JSONSerialization.jsonObject(with: data)) ?? String(data: data, encoding: .utf8)
    case "text", "form", "multipart":
        return String(data: data, encoding: .utf8)
    case "binary":
        return data.base64EncodedString()
    default:
        return nil
    }
}

func inferBodyType(contentType: String?, bytes: [UInt8]) -> String {
    guard !bytes.isEmpty else {
        return "empty"
    }
    let contentType = contentType?.lowercased() ?? ""
    if contentType.contains("application/json") {
        return "json"
    }
    if contentType.hasPrefix("text/") {
        return "text"
    }
    if contentType.contains("application/x-www-form-urlencoded") {
        return "form"
    }
    if contentType.contains("multipart/form-data") {
        return "multipart"
    }
    return "binary"
}

func inferBodyType(_ body: Any?) -> String {
    guard let body else {
        return "empty"
    }
    return body is String ? "text" : "json"
}

func normalizeOptionalJobStatus(_ status: String?) -> String? {
    switch status {
    case "queued", "running", "completed", "failed", "cancelled", "expired":
        return status
    default:
        return nil
    }
}

func estimateBodySize(_ body: Any?, bodyType: String) -> Int {
    guard let body else {
        return 0
    }
    if bodyType == "binary", let string = body as? String {
        return (string.count * 3) / 4
    }
    if let string = body as? String {
        return string.data(using: .utf8)?.count ?? 0
    }
    if JSONSerialization.isValidJSONObject(body),
       let data = try? JSONSerialization.data(withJSONObject: body) {
        return data.count
    }
    return "\(body)".data(using: .utf8)?.count ?? 0
}

func toJSValue(_ value: Any?) -> JSValue {
    guard let value else {
        return NSNull()
    }
    if let value = value as? JSValue {
        return value
    }
    if let dictionary = value as? [String: Any] {
        var object: JSObject = [:]
        for (key, nestedValue) in dictionary {
            object[key] = toJSValue(nestedValue)
        }
        return object
    }
    if let array = value as? [Any] {
        return array.map { toJSValue($0) }
    }
    return String(describing: value)
}

func discoverLanUrls(port: Int) -> [String] {
    var addresses: [String] = []
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let first = ifaddr else {
        return addresses
    }
    defer { freeifaddrs(ifaddr) }

    for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
        let interface = pointer.pointee
        let family = interface.ifa_addr.pointee.sa_family
        if family == UInt8(AF_INET) {
            var address = interface.ifa_addr.pointee
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(&address, socklen_t(interface.ifa_addr.pointee.sa_len), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
            let value = String(cString: hostname)
            if value != "127.0.0.1" {
                addresses.append("http://\(value):\(port)")
            }
        }
    }
    return Array(Set(addresses)).sorted()
}

func now() -> String {
    ISO8601DateFormatter().string(from: Date())
}

func intValue(_ value: Any?, defaultValue: Int) -> Int {
    if let int = value as? Int {
        return int
    }
    if let number = value as? NSNumber {
        return number.intValue
    }
    if let string = value as? String, let int = Int(string) {
        return int
    }
    return defaultValue
}

func doubleValue(_ value: Any?, defaultValue: Double) -> Double {
    if let double = value as? Double {
        return double
    }
    if let number = value as? NSNumber {
        return number.doubleValue
    }
    if let string = value as? String, let double = Double(string) {
        return double
    }
    return defaultValue
}

func optionalDoubleValue(_ value: Any?) -> Double? {
    if let double = value as? Double {
        return double
    }
    if let number = value as? NSNumber {
        return number.doubleValue
    }
    if let string = value as? String {
        return Double(string)
    }
    return nil
}
