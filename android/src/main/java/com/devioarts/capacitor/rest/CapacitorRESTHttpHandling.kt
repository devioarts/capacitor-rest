package com.devioarts.capacitor.rest

import android.util.Base64
import com.getcapacitor.JSObject
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.httpMethod
import io.ktor.server.request.receiveChannel
import io.ktor.server.request.uri
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.util.UUID

internal suspend fun CapacitorREST.handleHttpCall(call: ApplicationCall) {
    try {
        val method = normalizeMethod(call.request.httpMethod.value)
        val uri = java.net.URI(call.request.uri)
        val path = normalizePath(uri.path ?: "/")

        if (method == "OPTIONS") {
            applyCors(call)
            call.respondBytes(ByteArray(0), status = HttpStatusCode.NoContent)
            return
        }

        // Enforce the body-size limit before auth so an oversized payload always yields
        // 413 regardless of the Authorization header, matching the Web/iOS/Electron order
        // and this class's own mockRequest() - which checks size before auth as well.
        val declaredContentLength = call.request.headers[HttpHeaders.ContentLength]?.toLongOrNull()
        if (declaredContentLength != null) {
            ensureBodySize(declaredContentLength)
        }

        if (!isAuthorized(call)) {
            respondPayload(call, ResponsePayload(401, bodyType = "json", body = JSObject().put("error", "Unauthorized")))
            return
        }

        val systemResponse = trySystemRoute(method, path, statusFromQuery(uri.rawQuery))
        if (systemResponse != null) {
            respondPayload(call, systemResponse)
            return
        }

        val routeMatch = matchRoute(method, path)
        if (routeMatch == null) {
            respondPayload(call, ResponsePayload(404, bodyType = "json", body = JSObject().put("error", "Route not found")))
            return
        }

        val request = buildRequest(call, routeMatch.route, routeMatch.params, path)
        if (routeMatch.route.mode == "async") {
            val job = createJob(request)
            bridge.emit("request", job.request ?: request)
            respondPayload(
                call,
                ResponsePayload(
                    202,
                    JSObject().put("location", "/__jobs/${job.jobId}"),
                    JSObject()
                        .put("jobId", job.jobId)
                        .put("status", job.status)
                        .put("location", "/__jobs/${job.jobId}"),
                    "json",
                ),
            )
            return
        }

        val response = waitForJsResponse(request, routeMatch.route.timeoutMs ?: options.requestTimeoutMs)
        respondPayload(call, response)
    } catch (error: BodyTooLargeException) {
        respondPayload(call, ResponsePayload(413, bodyType = "json", body = JSObject().put("error", error.message)))
    } catch (error: CancellationException) {
        // CancellationException is a subtype of Exception, so it would otherwise be caught by
        // the generic handler below and treated as a request error (attempting to write a
        // response on a connection Ktor is already tearing down). Rethrowing preserves
        // structured concurrency - e.g. a client disconnecting mid-request.
        throw error
    } catch (error: Exception) {
        bridge.emit("error", JSObject().put("message", error.message ?: "HTTP server error"))
        respondPayload(call, ResponsePayload(500, bodyType = "json", body = JSObject().put("error", error.message ?: "HTTP server error")))
    }
}

internal suspend fun CapacitorREST.waitForJsResponse(
    request: JSObject,
    timeoutMs: Long,
): ResponsePayload {
    val requestId = request.getString("id") ?: UUID.randomUUID().toString()
    val deferred = CompletableDeferred<ResponsePayload>()
    pending[requestId] = deferred
    bridge.emit("request", request)
    return try {
        withTimeout(timeoutMs) {
            deferred.await()
        }
    } catch (error: TimeoutCancellationException) {
        pending.remove(requestId)
        ResponsePayload(504, bodyType = "json", body = JSObject().put("error", "Request $requestId timed out"))
    } catch (error: CancellationException) {
        // The call itself was cancelled (client disconnected / server stopping): clean up and
        // let the cancellation propagate instead of pretending the request timed out.
        pending.remove(requestId)
        throw error
    }
}

private suspend fun CapacitorREST.buildRequest(
    call: ApplicationCall,
    route: RouteRecord,
    params: JSObject,
    path: String,
): JSObject {
    val contentLength = call.request.headers[HttpHeaders.ContentLength]?.toLongOrNull()
    if (contentLength != null) {
        ensureBodySize(contentLength)
    }
    // Content-Length is absent for chunked-encoded requests, so the cap must also be
    // enforced while streaming: reading the whole body into memory first (as
    // call.receive<ByteArray>() does) would let a request with no Content-Length bypass
    // maxBodySizeBytes entirely and exhaust memory before the size is ever checked.
    val bytes = receiveBodyWithLimit(call, options.maxBodySizeBytes)
    val contentType = call.request.headers[HttpHeaders.ContentType] ?: ""
    val bodyType = inferBodyType(contentType, bytes)

    return JSObject()
        .put("id", UUID.randomUUID().toString())
        .put("method", route.method)
        .put("path", path)
        .put("route", route.path)
        .put("params", params)
        .put("query", parseQuery(call))
        .put("headers", parseHeaders(call))
        .put("bodyType", bodyType)
        .put("body", parseBody(bytes, bodyType))
        .put("remoteAddress", call.request.local.remoteHost)
        .put("receivedAt", now())
}

private fun CapacitorREST.ensureBodySize(size: Long) {
    if (size > options.maxBodySizeBytes) {
        throw BodyTooLargeException(options.maxBodySizeBytes)
    }
}

/**
 * Reads the request body incrementally, aborting as soon as [maxBodySizeBytes] is exceeded
 * instead of buffering an unbounded amount of data before checking the limit.
 */
private suspend fun receiveBodyWithLimit(
    call: ApplicationCall,
    maxBodySizeBytes: Long,
): ByteArray {
    val channel = call.receiveChannel()
    val output = ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (true) {
        val read = channel.readAvailable(chunk, 0, chunk.size)
        if (read == -1) {
            break
        }
        if (read > 0) {
            output.write(chunk, 0, read)
            if (output.size() > maxBodySizeBytes) {
                throw BodyTooLargeException(maxBodySizeBytes)
            }
        }
    }
    return output.toByteArray()
}

private suspend fun CapacitorREST.respondPayload(
    call: ApplicationCall,
    payload: ResponsePayload,
) {
    applyCors(call)
    var hasCustomContentType = false
    payload.headers.keys().forEach { key ->
        if (key.equals("content-type", ignoreCase = true)) {
            hasCustomContentType = true
        } else if (key.equals("content-length", ignoreCase = true)) {
            // Skip: Ktor's respondBytes/respondText compute their own Content-Length from the
            // actual body it writes, so passing through a handler-supplied value here would
            // produce two conflicting Content-Length headers on the wire (RFC 7230 §3.3.2).
            return@forEach
        }
        call.response.header(key, payload.headers.optString(key))
    }
    val status = HttpStatusCode.fromValue(payload.status)
    // If the handler already supplied its own "content-type" header above, don't also pass
    // a default ContentType here - respondBytes/respondText would add a second, conflicting
    // Content-Type header rather than replacing the one already set via call.response.header.
    when (payload.bodyType) {
        "empty" -> call.respondBytes(ByteArray(0), status = status)
        "binary" -> {
            val body = payload.body as? String ?: ""
            val contentType = if (hasCustomContentType) null else ContentType.Application.OctetStream
            call.respondBytes(Base64.decode(body, Base64.NO_WRAP), contentType, status)
        }
        "text" -> {
            val contentType = if (hasCustomContentType) null else ContentType.Text.Plain
            call.respondText(payload.body?.toString() ?: "", contentType, status)
        }
        else -> {
            val contentType = if (hasCustomContentType) null else ContentType.Application.Json
            call.respondText(jsonString(payload.body), contentType, status)
        }
    }
}

internal fun CapacitorREST.isAuthorized(call: ApplicationCall): Boolean {
    val auth = options.auth
    if (auth.type == "none") {
        return true
    }
    val header = call.request.headers[HttpHeaders.Authorization] ?: ""
    return constantTimeEquals(header, "Bearer ${auth.token}")
}

/**
 * Applies CORS headers directly to [call]'s response, or does nothing if the request's
 * `Origin` isn't allowed (in which case the browser blocks the cross-origin read).
 */
internal fun CapacitorREST.applyCors(call: ApplicationCall) {
    val cors = options.cors
    if (!cors.enabled) {
        return
    }
    val allowOrigin = resolveAllowOrigin(call.request.headers[HttpHeaders.Origin], cors) ?: return
    call.response.header(HttpHeaders.AccessControlAllowOrigin, allowOrigin)
    call.response.header(HttpHeaders.AccessControlAllowMethods, cors.methods.joinToString(","))
    call.response.header(HttpHeaders.AccessControlAllowHeaders, cors.headers.joinToString(","))
    if (cors.exposeHeaders.isNotEmpty()) {
        call.response.header(HttpHeaders.AccessControlExposeHeaders, cors.exposeHeaders.joinToString(","))
    }
    if (cors.allowCredentials) {
        call.response.header(HttpHeaders.AccessControlAllowCredentials, "true")
    }
    call.response.header(HttpHeaders.AccessControlMaxAge, cors.maxAgeSeconds.toString())
    call.response.header("vary", "Origin")
}
