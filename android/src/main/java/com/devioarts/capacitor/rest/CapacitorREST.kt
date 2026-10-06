package com.devioarts.capacitor.rest

import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import io.ktor.server.cio.CIO
import io.ktor.server.cio.CIOApplicationEngine
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.head
import io.ktor.server.routing.options
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.routing
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

interface RestServerBridge {
    fun emit(
        eventName: String,
        payload: JSObject,
    )
}

class CapacitorREST(internal val bridge: RestServerBridge) {
    internal var context: Context? = null

    // server/options/jobScope are all reassigned by start()/stop() (called from the plugin's
    // own dispatcher) and read concurrently from Ktor's CIO worker threads while handling
    // in-flight requests. @Volatile makes the new reference visible to those threads without
    // requiring every read site to take a lock.
    @Volatile
    internal var server: EmbeddedServer<CIOApplicationEngine, CIOApplicationEngine.Configuration>? = null

    @Volatile
    internal var options = ServerOptions()
    internal val routes = ConcurrentHashMap<String, RouteRecord>()
    private val routeSequence = AtomicLong(0)
    internal val pending = ConcurrentHashMap<String, CompletableDeferred<ResponsePayload>>()
    internal val jobs = ConcurrentHashMap<String, JobRecord>()

    @Volatile
    internal var jobScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun setContext(context: Context) {
        this.context = context.applicationContext
    }

    // start()/stop() can block for seconds (Ktor's graceful shutdown) and must never interleave:
    // two overlapping calls could otherwise leave a bound server that nothing references.
    private val lifecycleLock = Any()

    fun start(data: JSObject): JSObject =
        synchronized(lifecycleLock) {
            if (server != null) {
                stopLocked()
            }

            val requested = ServerOptions.from(data)
            options = requested
            val engine =
                embeddedServer(CIO, host = requested.host, port = requested.port) {
                    routing {
                        get("{...}") { handleHttpCall(call) }
                        post("{...}") { handleHttpCall(call) }
                        put("{...}") { handleHttpCall(call) }
                        patch("{...}") { handleHttpCall(call) }
                        delete("{...}") { handleHttpCall(call) }
                        head("{...}") { handleHttpCall(call) }
                        options("{...}") { handleHttpCall(call) }
                    }
                }.start(wait = false)

            // Port 0 asks the OS for a free port. Read back the port the engine really bound to
            // instead of probing for a free one beforehand, which could be taken in between.
            val boundPort =
                if (requested.port == 0) {
                    runBlocking { engine.engine.resolvedConnectors().first().port }
                } else {
                    requested.port
                }
            options = requested.copy(port = boundPort)
            server = engine

            val info = getInfo()
            bridge.emit("started", JSObject().put("info", info))
            info
        }

    fun stop() {
        synchronized(lifecycleLock) { stopLocked() }
    }

    private fun stopLocked() {
        // Release in-flight sync requests (503) *before* stopping the engine: Ktor's graceful
        // shutdown waits for running calls, and those calls only finish once their pending
        // deferred is completed - doing it afterwards would stall every stop() for the full
        // grace period.
        failPendingRequests()
        server?.stop(1000, 3000)
        server = null
        failPendingRequests()
        bridge.emit("stopped", JSObject().put("info", getInfo()))
    }

    private fun failPendingRequests() {
        for (requestId in pending.keys.toList()) {
            pending.remove(requestId)?.complete(
                ResponsePayload(503, bodyType = "json", body = JSObject().put("error", "Server stopped")),
            )
        }
    }

    fun dispose() {
        stop()
        jobScope.cancel()
        jobScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        // The expiry coroutines died with the old scope, so queued/running jobs would otherwise
        // stay in that state forever; the JS side that could answer them is gone as well.
        jobs.clear()
        routes.clear()
    }

    fun getInfo(): JSObject {
        val urls = JSArray()
        if (server != null) {
            discoverLanAddresses().forEach { address ->
                urls.put("http://$address:${options.port}")
            }
        }

        return JSObject()
            .put("running", server != null)
            .put("host", options.host)
            .put("port", if (server != null) options.port else 0)
            .put("urls", urls)
            .put("mock", false)
    }

    fun registerRoute(data: JSObject): JSObject {
        val method = normalizeMethod(data.getString("method") ?: error("method is required"))
        val path = normalizePath(data.getString("path") ?: error("path is required"))
        val mode = data.getString("mode") ?: "sync"
        val timeoutMs = data.optLongOrNull("timeoutMs")
        val key = routeKey(method, path)
        // Re-registering an existing route keeps its original position (matchRoute() order)
        // rather than moving it to the end, mirroring plain map-assignment semantics.
        val sequence = routes[key]?.sequence ?: routeSequence.getAndIncrement()
        val route = RouteRecord(method, path, mode, timeoutMs, pathSegments(path), sequence)
        routes[key] = route
        return route.toJSObject()
    }

    fun unregisterRoute(data: JSObject) {
        val method = normalizeMethod(data.getString("method") ?: return)
        val path = normalizePath(data.getString("path") ?: return)
        routes.remove(routeKey(method, path))
    }

    fun clearRoutes() {
        routes.clear()
    }

    fun respond(data: JSObject) {
        val requestId = data.getString("requestId") ?: error("requestId is required")
        val deferred = pending.remove(requestId) ?: error("Request $requestId is not pending")
        deferred.complete(ResponsePayload.from(data))
    }

    fun completeJob(data: JSObject): JSObject {
        val jobId = data.getString("jobId") ?: error("jobId is required")
        val responseObject = data.getJSObject("response") ?: error("response is required")
        // compute() makes the read-modify-write atomic against the expiry sweep in createJob(),
        // which otherwise could race a completeJob() call and overwrite "completed" back to
        // "expired" if both land on the same entry at nearly the same time.
        var updated: JobRecord? = null
        jobs.compute(jobId) { _, current ->
            val job = current ?: error("Job $jobId was not found")
            requireOpen(job)
            job.copy(
                status = "completed",
                updatedAt = now(),
                response = ResponsePayload.from(responseObject),
                error = null,
            ).also { updated = it }
        }
        enforceJobRetentionCap()
        emitJobUpdated(updated!!)
        return updated!!.toJSObject()
    }

    fun failJob(data: JSObject): JSObject {
        val jobId = data.getString("jobId") ?: error("jobId is required")
        val status = data.getString("status") ?: "failed"
        if (status != "failed" && status != "cancelled") {
            error("status must be 'failed' or 'cancelled'")
        }
        var updated: JobRecord? = null
        jobs.compute(jobId) { _, current ->
            val job = current ?: error("Job $jobId was not found")
            requireOpen(job)
            job.copy(
                status = status,
                updatedAt = now(),
                error = data.getString("error") ?: "Job failed",
            ).also { updated = it }
        }
        enforceJobRetentionCap()
        emitJobUpdated(updated!!)
        return updated!!.toJSObject()
    }

    private fun requireOpen(job: JobRecord) {
        if (job.status != "queued" && job.status != "running") {
            error("Job ${job.jobId} is already ${job.status}")
        }
    }

    fun getJob(data: JSObject): JSObject {
        val jobId = data.getString("jobId") ?: error("jobId is required")
        return (jobs[jobId] ?: error("Job $jobId was not found")).toJSObject()
    }

    fun listJobs(data: JSObject = JSObject()): JSObject {
        return JSObject().put("jobs", listJobs(data.getString("status")))
    }

    fun deleteJob(data: JSObject) {
        val jobId = data.getString("jobId") ?: return
        jobs.remove(jobId)
    }
}
