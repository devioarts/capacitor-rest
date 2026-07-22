package com.devioarts.capacitor.rest

import com.getcapacitor.JSObject
import io.ktor.http.HttpHeaders
import java.net.URI
import java.util.UUID

internal suspend fun CapacitorREST.mockRequest(data: JSObject): JSObject {
    if (server == null) {
        error("Server is not running")
    }

    val method = normalizeMethod(data.getString("method") ?: "GET")
    val uri = URI(data.getString("path") ?: "/")
    val path = normalizePath(uri.path ?: "/")
    val headers = normalizeHeaders(data.getJSObject("headers") ?: JSObject())
    val requestOrigin = headers.optString("origin").ifEmpty { null }
    val body = if (data.has("body")) data.opt("body") else null
    val bodyType = data.getString("bodyType") ?: inferBodyType(body)

    // OPTIONS is checked before the body-size limit, matching the real HTTP handler
    // (handleHttpCall) - a preflight request should always get a plain 204, regardless of
    // what a caller happens to put in a mocked OPTIONS call's body/bodyType.
    if (method == "OPTIONS") {
        return withCors(ResponsePayload(204, bodyType = "empty"), requestOrigin).toJSObject()
    }

    if (estimateBodySize(body, bodyType) > options.maxBodySizeBytes) {
        return withCors(
            ResponsePayload(413, bodyType = "json", body = JSObject().put("error", "Payload too large")),
            requestOrigin,
        ).toJSObject()
    }

    if (!isAuthorized(headers)) {
        return withCors(ResponsePayload(401, bodyType = "json", body = JSObject().put("error", "Unauthorized")), requestOrigin).toJSObject()
    }

    val systemResponse = trySystemRoute(method, path, statusFromQuery(uri.rawQuery))
    if (systemResponse != null) {
        return withCors(systemResponse, requestOrigin).toJSObject()
    }

    val routeMatch =
        matchRoute(method, path)
            ?: return withCors(
                ResponsePayload(404, bodyType = "json", body = JSObject().put("error", "Route not found")),
                requestOrigin,
            ).toJSObject()

    val request =
        JSObject()
            .put("id", UUID.randomUUID().toString())
            .put("method", routeMatch.route.method)
            .put("path", path)
            .put("route", routeMatch.route.path)
            .put("params", routeMatch.params)
            .put("query", parseQuery(uri.rawQuery))
            .put("headers", headers)
            .put("bodyType", bodyType)
            .put("body", body)
            .put("remoteAddress", data.getString("remoteAddress"))
            .put("receivedAt", now())

    if (routeMatch.route.mode == "async") {
        val job = createJob(request)
        bridge.emit("request", job.request ?: request)
        return withCors(
            ResponsePayload(
                202,
                JSObject().put("location", "/__jobs/${job.jobId}"),
                JSObject()
                    .put("jobId", job.jobId)
                    .put("status", job.status)
                    .put("location", "/__jobs/${job.jobId}"),
                "json",
            ),
            requestOrigin,
        ).toJSObject()
    }

    return withCors(waitForJsResponse(request, routeMatch.route.timeoutMs ?: options.requestTimeoutMs), requestOrigin).toJSObject()
}

internal fun CapacitorREST.isAuthorized(headers: JSObject): Boolean {
    val auth = options.auth
    if (auth.type == "none") {
        return true
    }
    return constantTimeEquals(headers.optString("authorization"), "Bearer ${auth.token}")
}

internal fun CapacitorREST.withCors(
    payload: ResponsePayload,
    requestOrigin: String?,
): ResponsePayload {
    val cors = options.cors
    if (!cors.enabled) {
        return payload
    }
    val allowOrigin = resolveAllowOrigin(requestOrigin, cors) ?: return payload
    val headers = JSObject(payload.headers.toString())
    headers.put(HttpHeaders.AccessControlAllowOrigin.lowercase(), allowOrigin)
    headers.put(HttpHeaders.AccessControlAllowMethods.lowercase(), cors.methods.joinToString(","))
    headers.put(HttpHeaders.AccessControlAllowHeaders.lowercase(), cors.headers.joinToString(","))
    headers.put(HttpHeaders.AccessControlMaxAge.lowercase(), cors.maxAgeSeconds.toString())
    headers.put("vary", "Origin")
    if (cors.exposeHeaders.isNotEmpty()) {
        headers.put(HttpHeaders.AccessControlExposeHeaders.lowercase(), cors.exposeHeaders.joinToString(","))
    }
    if (cors.allowCredentials) {
        headers.put(HttpHeaders.AccessControlAllowCredentials.lowercase(), "true")
    }
    return payload.copy(headers = headers)
}
