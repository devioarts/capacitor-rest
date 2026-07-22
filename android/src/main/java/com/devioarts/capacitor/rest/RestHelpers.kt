package com.devioarts.capacitor.rest

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.NetworkCapabilities
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import io.ktor.server.application.ApplicationCall
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.security.MessageDigest
import java.time.Instant

internal fun ServerOptions.withResolvedPort(): ServerOptions {
    if (port != 0) {
        return this
    }
    return copy(port = findAvailablePort())
}

internal fun findAvailablePort(): Int =
    ServerSocket(0).use { socket ->
        socket.localPort
    }

/**
 * Resolves the `Access-Control-Allow-Origin` value for a request, or `null` if the request's
 * origin is not allowed (in which case no CORS headers should be sent at all). A comma-joined
 * list of origins is not valid header syntax, so an explicit allowlist is matched against the
 * request's actual `Origin` header instead of being echoed back verbatim.
 */
internal fun resolveAllowOrigin(
    requestOrigin: String?,
    cors: CorsOptions,
): String? {
    if (cors.origins.contains("*")) {
        return if (cors.allowCredentials && requestOrigin != null) requestOrigin else "*"
    }
    return if (requestOrigin != null && cors.origins.contains(requestOrigin)) requestOrigin else null
}

/**
 * Constant-time string comparison so bearer token checks don't leak timing information.
 * `MessageDigest.isEqual` is documented to run in time independent of where the arrays first
 * differ.
 */
internal fun constantTimeEquals(
    a: String,
    b: String,
): Boolean = MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

/**
 * `URLDecoder.decode` throws `IllegalArgumentException` for a malformed escape sequence
 * (e.g. a lone `%`). Falling back to the raw, still-encoded value keeps route matching and
 * job lookups resolving with an ordinary "not found" response instead of throwing.
 */
internal fun safeUrlDecode(value: String): String = runCatching { java.net.URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)

internal fun normalizeMethod(method: String): String = method.uppercase()

internal fun normalizePath(path: String): String = if (path.startsWith("/")) path else "/$path"

internal fun routeKey(
    method: String,
    path: String,
): String = "${normalizeMethod(method)} ${normalizePath(path)}"

internal fun pathSegments(path: String): List<String> = normalizePath(path).split("/").filter { it.isNotEmpty() }

internal fun matchSegments(
    routeSegments: List<String>,
    requestSegments: List<String>,
): JSObject? {
    val params = JSObject()
    for (index in routeSegments.indices) {
        val routeSegment = routeSegments[index]
        val requestSegment = requestSegments.getOrNull(index)
        if (routeSegment == "*") {
            params.put("*", requestSegments.drop(index).joinToString("/"))
            return params
        }
        if (requestSegment == null) {
            return null
        }
        if (routeSegment.startsWith(":")) {
            params.put(routeSegment.drop(1), safeUrlDecode(requestSegment))
        } else if (routeSegment != requestSegment) {
            return null
        }
    }
    return if (routeSegments.size == requestSegments.size) params else null
}

internal fun parseHeaders(call: ApplicationCall): JSObject {
    val headers = JSObject()
    call.request.headers.forEach { key, values ->
        headers.put(key.lowercase(), values.joinToString(","))
    }
    return headers
}

internal fun parseQuery(call: ApplicationCall): JSObject {
    val query = JSObject()
    call.request.queryParameters.names().forEach { key ->
        val values = call.request.queryParameters.getAll(key).orEmpty()
        if (values.size > 1) {
            query.put(key, JSArray(values))
        } else {
            query.put(key, values.firstOrNull() ?: "")
        }
    }
    return query
}

internal fun parseQuery(rawQuery: String?): JSObject {
    val query = JSObject()
    if (rawQuery.isNullOrBlank()) {
        return query
    }
    rawQuery.split("&").forEach { pair ->
        val parts = pair.split("=", limit = 2)
        val key = safeUrlDecode(parts[0])
        val value = safeUrlDecode(parts.getOrNull(1) ?: "")
        val current = if (query.has(key)) query.opt(key) else null
        when (current) {
            is JSArray -> current.put(value)
            is String -> query.put(key, JSArray(listOf(current, value)))
            null -> query.put(key, value)
            else -> query.put(key, JSArray(listOf(current.toString(), value)))
        }
    }
    return query
}

internal fun statusFromQuery(rawQuery: String?): String? {
    return normalizeOptionalJobStatus(parseQuery(rawQuery).getString("status"))
}

internal fun parseBody(
    bytes: ByteArray,
    bodyType: String,
): Any? {
    if (bytes.isEmpty()) {
        return null
    }
    return when (bodyType) {
        "json" -> runCatching { JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue() }.getOrElse { bytes.toString(Charsets.UTF_8) }
        "text", "form", "multipart" -> bytes.toString(Charsets.UTF_8)
        "binary" -> Base64.encodeToString(bytes, Base64.NO_WRAP)
        else -> null
    }
}

internal fun inferBodyType(
    contentType: String,
    bytes: ByteArray,
): String {
    if (bytes.isEmpty()) {
        return "empty"
    }
    return when {
        contentType.contains("application/json", ignoreCase = true) -> "json"
        contentType.startsWith("text/", ignoreCase = true) -> "text"
        contentType.contains("application/x-www-form-urlencoded", ignoreCase = true) -> "form"
        contentType.contains("multipart/form-data", ignoreCase = true) -> "multipart"
        else -> "binary"
    }
}

internal fun inferBodyType(body: Any?): String =
    when (body) {
        null -> "empty"
        is JSONObject, is JSONArray, is JSObject, is JSArray -> "json"
        is String -> "text"
        else -> "json"
    }

internal fun normalizeOptionalJobStatus(status: String?): String? {
    return when (status) {
        "queued", "running", "completed", "failed", "cancelled", "expired" -> status
        else -> null
    }
}

internal fun estimateBodySize(
    body: Any?,
    bodyType: String,
): Long {
    if (body == null) {
        return 0
    }
    if (bodyType == "binary" && body is String) {
        return ((body.length * 3) / 4).toLong()
    }
    return when (body) {
        is String -> body.toByteArray(Charsets.UTF_8).size.toLong()
        else -> jsonString(body).toByteArray(Charsets.UTF_8).size.toLong()
    }
}

internal fun normalizeHeaders(headers: JSObject): JSObject {
    val normalized = JSObject()
    headers.keys().forEach { key ->
        normalized.put(key.lowercase(), headers.optString(key))
    }
    return normalized
}

internal fun jsonString(body: Any?): String =
    when (body) {
        // org.json represents an explicit JSON `null` value (e.g. from JSONObject.opt("body")
        // on a key whose value is literally `null`) as the JSONObject.NULL sentinel, not
        // Kotlin `null` - without this branch it falls through to the `else` case below and
        // gets wrapped in quotes, sending the client the string "null" instead of the JSON
        // literal null.
        null, JSONObject.NULL -> "null"
        is JSONObject, is JSONArray, is JSObject, is JSArray -> body.toString()
        // JSONObject.wrap() returns String/Boolean/Number values unchanged rather than encoding
        // them, so a raw body (e.g. bodyType "json" with a String body) must be quoted/escaped
        // explicitly here - otherwise it would be sent as invalid, unquoted JSON.
        is Boolean, is Int, is Long, is Double, is Float, is Short -> body.toString()
        is String -> JSONObject.quote(body)
        else -> JSONObject.quote(body.toString())
    }

internal fun now(): String = Instant.now().toString()

internal fun JSObject.optLongOrNull(key: String): Long? = if (has(key) && !isNull(key)) optLong(key) else null

internal fun JSObject.optStringArray(key: String): List<String>? {
    if (!has(key) || isNull(key)) {
        return null
    }
    val array = getJSONArray(key)
    return List(array.length()) { index -> array.getString(index) }
}

@Suppress("DEPRECATION")
internal fun CapacitorREST.discoverLanAddresses(): List<String> {
    val addresses = linkedSetOf<String>()
    runCatching {
        val connectivityManager = context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        connectivityManager?.allNetworks?.forEach { network ->
            val capabilities = connectivityManager.getNetworkCapabilities(network)
            if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true) {
                connectivityManager.getLinkProperties(network)?.linkAddresses?.map(LinkAddress::getAddress)?.forEach { address ->
                    if (address is Inet4Address && !address.isLoopbackAddress) {
                        addresses.add(address.hostAddress ?: "")
                    }
                }
            }
        }
    }
    runCatching {
        NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }.forEach { address ->
            if (address is Inet4Address && !address.isLoopbackAddress) {
                addresses.add(address.hostAddress ?: "")
            }
        }
    }
    return addresses.filter { it.isNotBlank() }
}
