package com.devioarts.capacitor.rest

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

internal fun CapacitorREST.createJob(request: JSObject): JobRecord {
    val createdAt = now()
    val jobId = UUID.randomUUID().toString()
    request.put("jobId", jobId)
    val job =
        JobRecord(
            jobId = jobId,
            status = "queued",
            createdAt = createdAt,
            updatedAt = createdAt,
            request = request,
        )
    jobs[job.jobId] = job
    jobScope.launch {
        delay(options.jobRetentionMs)
        // compute() makes this read-modify-write atomic against completeJob()/failJob(),
        // which otherwise could race this expiry sweep and have their "completed"/"failed"
        // write clobbered back to "expired" if both land on the same entry at nearly the
        // same time.
        var updated: JobRecord? = null
        jobs.computeIfPresent(job.jobId) { _, current ->
            if (current.status in setOf("queued", "running")) {
                current.copy(status = "expired", updatedAt = now()).also { updated = it }
            } else {
                current
            }
        }
        updated?.let {
            enforceJobRetentionCap()
            emitJobUpdated(it)
        }
    }
    return job
}

/**
 * Evicts the oldest terminal-state jobs (never "queued"/"running") once the retained job
 * count exceeds [ServerOptions.maxRetainedJobs], so a client that never calls deleteJob()
 * can't grow the job map - and the full request/response bodies it holds - without bound.
 */
internal fun CapacitorREST.enforceJobRetentionCap() {
    var excess = jobs.size - options.maxRetainedJobs
    if (excess <= 0) {
        return
    }
    val terminalStatuses = setOf("completed", "failed", "cancelled", "expired")
    jobs.values
        .filter { it.status in terminalStatuses }
        // Instant.parse (not raw string comparison) because Instant.toString() truncates
        // trailing zero fractional digits, so two createdAt strings from the same second
        // don't always sort correctly as plain strings.
        .sortedBy { Instant.parse(it.createdAt) }
        .forEach { job ->
            if (excess > 0 && jobs.remove(job.jobId) != null) {
                excess -= 1
            }
        }
}

internal fun CapacitorREST.listJobs(status: String?): JSArray {
    val normalizedStatus = normalizeOptionalJobStatus(status)
    val array = JSArray()
    jobs.values
        .filter { normalizedStatus == null || it.status == normalizedStatus }
        .sortedBy { Instant.parse(it.createdAt) }
        .forEach { array.put(it.toJSObject()) }
    return array
}

internal fun CapacitorREST.emitJobUpdated(job: JobRecord) {
    bridge.emit("jobUpdated", JSObject().put("job", job.toJSObject()))
}

internal fun CapacitorREST.trySystemRoute(
    method: String,
    path: String,
    status: String? = null,
): ResponsePayload? {
    if (path == "/__jobs") {
        return if (method == "GET") {
            ResponsePayload(200, bodyType = "json", body = JSObject().put("jobs", listJobs(status)))
        } else {
            ResponsePayload(405, bodyType = "json", body = JSObject().put("error", "Method not allowed"))
        }
    }

    val match = Regex("^/__jobs/([^/]+)$").matchEntire(path) ?: return null
    val jobId = safeUrlDecode(match.groupValues[1])
    return when (method) {
        "GET" -> {
            val job = jobs[jobId]
            if (job == null) {
                ResponsePayload(404, bodyType = "json", body = JSObject().put("error", "Job not found"))
            } else {
                ResponsePayload(200, bodyType = "json", body = job.toJSObject())
            }
        }
        "DELETE" -> {
            jobs.remove(jobId)
            ResponsePayload(204, bodyType = "empty")
        }
        else -> ResponsePayload(405, bodyType = "json", body = JSObject().put("error", "Method not allowed"))
    }
}

internal fun CapacitorREST.matchRoute(
    method: String,
    path: String,
): RouteMatch? {
    val requestSegments = pathSegments(path)
    // Sorted by registration order (see RouteRecord.sequence) rather than iterating
    // routes.values directly, since ConcurrentHashMap's iteration order is unspecified and
    // ambiguous overlapping routes (e.g. "/users/:id" and "/users/me") need a deterministic
    // first-registered-wins tie-break.
    for (route in routes.values.sortedBy { it.sequence }) {
        if (route.method != method) {
            continue
        }
        val params = matchSegments(route.segments, requestSegments)
        if (params != null) {
            return RouteMatch(route, params)
        }
    }
    return null
}
