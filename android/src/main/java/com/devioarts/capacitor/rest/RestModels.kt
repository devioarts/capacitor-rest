package com.devioarts.capacitor.rest

import com.getcapacitor.JSObject

internal data class ServerOptions(
    val host: String = "0.0.0.0",
    val port: Int = 8080,
    val requestTimeoutMs: Long = 30_000,
    val jobRetentionMs: Long = 300_000,
    val maxBodySizeBytes: Long = 10 * 1024 * 1024,
    val maxRetainedJobs: Int = 1000,
    val auth: AuthOptions = AuthOptions("none", null),
    val cors: CorsOptions = CorsOptions(),
) {
    companion object {
        fun from(data: JSObject): ServerOptions {
            val authObject = data.getJSObject("auth")
            val corsObject = data.getJSObject("cors")
            val authType = authObject?.getString("type") ?: "none"
            val authToken = authObject?.getString("token")
            if (authType != "none" && authType != "bearer") {
                // Without this check, an unrecognized type (e.g. a typo like "baerer") would
                // silently fall through isAuthorized()'s `auth.type == "none"` check as false,
                // making every request unconditionally 401 instead of surfacing the config
                // mistake at start() time.
                error("auth.type must be 'none' or 'bearer'")
            }
            if (authType == "bearer" && authToken.isNullOrEmpty()) {
                error("auth.token is required when auth.type is 'bearer'")
            }
            return ServerOptions(
                host = data.getString("host") ?: "0.0.0.0",
                port = data.getInteger("port") ?: 8080,
                requestTimeoutMs = data.optLongOrNull("requestTimeoutMs") ?: 30_000,
                jobRetentionMs = data.optLongOrNull("jobRetentionMs") ?: 300_000,
                maxBodySizeBytes = data.optLongOrNull("maxBodySizeBytes") ?: 10 * 1024 * 1024,
                maxRetainedJobs = data.optInt("maxRetainedJobs", 1000),
                auth = AuthOptions(type = authType, token = authToken),
                cors = CorsOptions.from(corsObject),
            )
        }
    }
}

internal data class AuthOptions(val type: String, val token: String?)

internal class BodyTooLargeException(maxBodySizeBytes: Long) : Exception(
    "Payload too large. Maximum request body size is $maxBodySizeBytes bytes",
)

internal data class CorsOptions(
    val enabled: Boolean = false,
    val origins: List<String> = listOf("*"),
    val methods: List<String> = listOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"),
    val headers: List<String> = listOf("authorization", "content-type"),
    val exposeHeaders: List<String> = emptyList(),
    val allowCredentials: Boolean = false,
    val maxAgeSeconds: Int = 600,
) {
    companion object {
        fun from(data: JSObject?): CorsOptions {
            if (data == null) {
                return CorsOptions()
            }
            return CorsOptions(
                enabled = data.optBoolean("enabled", false),
                origins = data.optStringArray("origins") ?: listOf("*"),
                methods = data.optStringArray("methods") ?: listOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"),
                headers = data.optStringArray("headers") ?: listOf("authorization", "content-type"),
                exposeHeaders = data.optStringArray("exposeHeaders") ?: emptyList(),
                allowCredentials = data.optBoolean("allowCredentials", false),
                maxAgeSeconds = data.optInt("maxAgeSeconds", 600),
            )
        }
    }
}

internal data class RouteRecord(
    val method: String,
    val path: String,
    val mode: String,
    val timeoutMs: Long?,
    val segments: List<String>,
    // Registration order, since ConcurrentHashMap iteration order is unspecified - if two
    // registered routes could both match the same request (e.g. "/users/:id" and "/users/me"),
    // matchRoute() needs a deterministic tie-break (first registered wins) rather than
    // whatever order the map's hashing happens to produce, which can change between runs.
    val sequence: Long,
) {
    fun toJSObject(): JSObject =
        JSObject()
            .put("method", method)
            .put("path", path)
            .put("mode", mode)
            .put("timeoutMs", timeoutMs)
}

internal data class RouteMatch(val route: RouteRecord, val params: JSObject)

internal data class JobRecord(
    val jobId: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val request: JSObject?,
    val response: ResponsePayload? = null,
    val error: String? = null,
) {
    fun toJSObject(): JSObject {
        val data =
            JSObject()
                .put("jobId", jobId)
                .put("status", status)
                .put("createdAt", createdAt)
                .put("updatedAt", updatedAt)
        request?.let { data.put("request", it) }
        response?.let { data.put("response", it.toJSObject()) }
        error?.let { data.put("error", it) }
        return data
    }
}

internal data class ResponsePayload(
    val status: Int,
    val headers: JSObject = JSObject(),
    val body: Any? = null,
    val bodyType: String = "empty",
) {
    fun toJSObject(): JSObject =
        JSObject()
            .put("status", status)
            .put("headers", headers)
            .put("body", body)
            .put("bodyType", bodyType)

    companion object {
        fun from(data: JSObject): ResponsePayload {
            val body = if (data.has("body")) data.opt("body") else null
            return ResponsePayload(
                status = data.getInteger("status") ?: 200,
                headers = data.getJSObject("headers") ?: JSObject(),
                body = body,
                bodyType = data.getString("bodyType") ?: inferBodyType(body),
            )
        }
    }
}
