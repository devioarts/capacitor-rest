package com.devioarts.capacitor.rest

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.HttpURLConnection
import java.net.URL

/** Fake bridge that records emitted events and lets a test act as the JS-side request handler. */
private class RecordingBridge : RestServerBridge {
    val events = mutableListOf<Pair<String, JSObject>>()
    var onRequest: ((JSObject) -> Unit)? = null

    override fun emit(
        eventName: String,
        payload: JSObject,
    ) {
        events.add(eventName to payload)
        if (eventName == "request") {
            onRequest?.invoke(payload)
        }
    }
}

/** Unit tests for the plain implementation class, per PLUGIN_DEV.md - never against the CAPPlugin dispatcher. */
class CapacitorRESTTest {
    private lateinit var bridge: RecordingBridge
    private lateinit var rest: CapacitorREST

    @BeforeEach
    fun setUp() {
        bridge = RecordingBridge()
        rest = CapacitorREST(bridge)
    }

    @AfterEach
    fun tearDown() {
        rest.stop()
    }

    private fun startServer(options: JSObject = JSObject().put("port", 0)): JSObject = rest.start(options)

    @Test
    fun `start resolves a running server with a resolved port`() {
        val info = startServer()
        assertTrue(info.getBoolean("running"))
        assertTrue((info.getInteger("port") ?: 0) > 0)
    }

    @Test
    fun `stop marks the server as not running`() {
        startServer()
        rest.stop()
        assertFalse(rest.getInfo().getBoolean("running"))
    }

    @Test
    fun `registerRoute defaults mode to sync and normalizes method-path`() {
        startServer()
        val route = rest.registerRoute(JSObject().put("method", "get").put("path", "orders/:id"))
        assertEquals("GET", route.getString("method"))
        assertEquals("/orders/:id", route.getString("path"))
        assertEquals("sync", route.getString("mode"))
    }

    @Test
    fun `unregisterRoute and clearRoutes remove matching from route table`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "GET").put("path", "/orders/:id"))
            rest.unregisterRoute(JSObject().put("method", "GET").put("path", "/orders/:id"))
            val notFound = rest.mockRequest(JSObject().put("method", "GET").put("path", "/orders/1"))
            assertEquals(404, notFound.getInteger("status"))

            rest.registerRoute(JSObject().put("method", "GET").put("path", "/other"))
            rest.clearRoutes()
            val alsoNotFound = rest.mockRequest(JSObject().put("method", "GET").put("path", "/other"))
            assertEquals(404, alsoNotFound.getInteger("status"))
        }

    @Test
    fun `mockRequest resolves route params through the JS handler`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "GET").put("path", "/orders/:id"))
            bridge.onRequest = { request ->
                val params = request.getJSObject("params")
                rest.respond(
                    JSObject()
                        .put("requestId", request.getString("id"))
                        .put("status", 200)
                        .put("bodyType", "json")
                        .put("body", JSObject().put("id", params?.getString("id"))),
                )
            }

            val response = rest.mockRequest(JSObject().put("method", "GET").put("path", "/orders/42"))
            assertEquals(200, response.getInteger("status"))
            assertEquals("42", response.getJSObject("body")?.getString("id"))
        }

    @Test
    fun `mockRequest returns 404 for an unmatched route`() =
        runTest {
            startServer()
            val response = rest.mockRequest(JSObject().put("method", "GET").put("path", "/nope"))
            assertEquals(404, response.getInteger("status"))
        }

    @Test
    fun `mockRequest returns 401 for a missing bearer token`() =
        runTest {
            startServer(
                JSObject().put("port", 0).put("auth", JSObject().put("type", "bearer").put("token", "secret")),
            )
            rest.registerRoute(JSObject().put("method", "GET").put("path", "/protected"))
            val response = rest.mockRequest(JSObject().put("method", "GET").put("path", "/protected"))
            assertEquals(401, response.getInteger("status"))
        }

    @Test
    fun `mockRequest returns 413 when the body exceeds maxBodySizeBytes`() =
        runTest {
            startServer(JSObject().put("port", 0).put("maxBodySizeBytes", 4))
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/upload"))
            val response =
                rest.mockRequest(
                    JSObject()
                        .put("method", "POST")
                        .put("path", "/upload")
                        .put("bodyType", "text")
                        .put("body", "way too big"),
                )
            assertEquals(413, response.getInteger("status"))
        }

    @Test
    fun `async route returns 202 with a job location, then completeJob resolves it`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/imports").put("mode", "async"))
            var jobId: String? = null
            bridge.onRequest = { request -> jobId = request.getString("jobId") }

            val response = rest.mockRequest(JSObject().put("method", "POST").put("path", "/imports"))
            assertEquals(202, response.getInteger("status"))
            assertNotNull(jobId)

            val completed =
                rest.completeJob(
                    JSObject()
                        .put("jobId", jobId)
                        .put(
                            "response",
                            JSObject().put("status", 201).put("bodyType", "json").put("body", JSObject().put("ok", true)),
                        ),
                )
            assertEquals("completed", completed.getString("status"))
            assertEquals(jobId, rest.getJob(JSObject().put("jobId", jobId)).getString("jobId"))
        }

    @Test
    fun `failJob marks a job failed with the given error`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/imports").put("mode", "async"))
            var jobId: String? = null
            bridge.onRequest = { request -> jobId = request.getString("jobId") }
            rest.mockRequest(JSObject().put("method", "POST").put("path", "/imports"))

            val failed = rest.failJob(JSObject().put("jobId", jobId).put("error", "boom"))
            assertEquals("failed", failed.getString("status"))
            assertEquals("boom", failed.getString("error"))
        }

    @Test
    fun `getJob rejects for an unknown job id (documented reject behavior)`() {
        startServer()
        val error =
            assertThrows(Exception::class.java) {
                rest.getJob(JSObject().put("jobId", "missing"))
            }
        assertNotNull(error.message)
    }

    @Test
    fun `listJobs and deleteJob manage retained jobs`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/imports").put("mode", "async"))
            var jobId: String? = null
            bridge.onRequest = { request -> jobId = request.getString("jobId") }
            rest.mockRequest(JSObject().put("method", "POST").put("path", "/imports"))

            assertEquals(1, rest.listJobs(JSObject()).getJSONArray("jobs").length())

            rest.deleteJob(JSObject().put("jobId", jobId))
            assertEquals(0, rest.listJobs(JSObject()).getJSONArray("jobs").length())
            assertThrows(Exception::class.java) { rest.getJob(JSObject().put("jobId", jobId)) }
        }

    @Test
    fun `real HTTP response never sends a duplicated Access-Control-Allow-Origin header`() {
        val info =
            startServer(
                JSObject()
                    .put("port", 0)
                    .put("cors", JSObject().put("enabled", true).put("origins", JSArray(listOf("*")))),
            )
        rest.registerRoute(JSObject().put("method", "GET").put("path", "/ping"))
        bridge.onRequest = { request ->
            rest.respond(
                JSObject()
                    .put("requestId", request.getString("id"))
                    .put("status", 200)
                    .put("bodyType", "json")
                    .put("body", JSObject().put("ok", true)),
            )
        }

        val port = info.getInteger("port")
        val connection = URL("http://127.0.0.1:$port/ping").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            assertEquals(200, connection.responseCode)
            val corsHeaders = connection.headerFields["Access-Control-Allow-Origin"].orEmpty()
            assertEquals(1, corsHeaders.size)
        } finally {
            connection.disconnect()
        }
    }

    @Test
    fun `a finished job cannot be completed or failed again`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/imports").put("mode", "async"))
            var jobId: String? = null
            bridge.onRequest = { request -> jobId = request.getString("jobId") }
            rest.mockRequest(JSObject().put("method", "POST").put("path", "/imports"))

            rest.failJob(JSObject().put("jobId", jobId).put("status", "cancelled").put("error", "stop"))
            val response = JSObject().put("status", 200)
            assertThrows(Exception::class.java) {
                rest.completeJob(JSObject().put("jobId", jobId).put("response", response))
            }
            assertThrows(Exception::class.java) { rest.failJob(JSObject().put("jobId", jobId).put("error", "again")) }
            assertEquals("cancelled", rest.getJob(JSObject().put("jobId", jobId)).getString("status"))
        }

    @Test
    fun `failJob rejects a status other than failed or cancelled`() =
        runTest {
            startServer()
            rest.registerRoute(JSObject().put("method", "POST").put("path", "/imports").put("mode", "async"))
            var jobId: String? = null
            bridge.onRequest = { request -> jobId = request.getString("jobId") }
            rest.mockRequest(JSObject().put("method", "POST").put("path", "/imports"))

            assertThrows(Exception::class.java) {
                rest.failJob(JSObject().put("jobId", jobId).put("status", "completed").put("error", "x"))
            }
        }

    @Test
    fun `stop answers an in-flight request with 503 without waiting for the grace period`() {
        val info = startServer()
        rest.registerRoute(JSObject().put("method", "GET").put("path", "/slow"))
        val port = info.getInteger("port")
        var code = -1
        val client =
            Thread {
                val connection = URL("http://127.0.0.1:$port/slow").openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 5000
                    connection.readTimeout = 10000
                    code = connection.responseCode
                } finally {
                    connection.disconnect()
                }
            }
        client.start()
        val deadline = System.currentTimeMillis() + 5000
        while (rest.pending.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
        assertFalse(rest.pending.isEmpty())

        val startedAt = System.currentTimeMillis()
        rest.stop()
        val elapsed = System.currentTimeMillis() - startedAt
        client.join(5000)

        assertEquals(503, code)
        assertTrue(elapsed < 900, "stop() took ${elapsed}ms")
    }
}
