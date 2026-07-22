package com.devioarts.capacitor.rest

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@CapacitorPlugin(name = "CapacitorREST")
class CapacitorRESTPlugin : Plugin(), RestServerBridge {
    private val implementation = CapacitorREST(this)
    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun load() {
        implementation.setContext(context)
    }

    override fun handleOnDestroy() {
        // handleOnDestroy() runs on the main/UI thread (it's invoked directly from the hosting
        // Activity's lifecycle callback), but implementation.stop() blocks for up to a few
        // seconds waiting for Ktor's graceful shutdown. Dispatch it on pluginScope's own IO
        // dispatcher instead of calling it inline, so Activity teardown isn't blocked (ANR risk).
        // The scope cancels itself only after stop() has finished, not before.
        pluginScope.launch {
            implementation.dispose()
            pluginScope.cancel()
        }
        super.handleOnDestroy()
    }

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            call.resolve(implementation.start(call.data))
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        implementation.stop()
        call.resolve()
    }

    @PluginMethod
    fun getInfo(call: PluginCall) {
        call.resolve(implementation.getInfo())
    }

    @PluginMethod
    fun registerRoute(call: PluginCall) {
        try {
            call.resolve(implementation.registerRoute(call.data))
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun unregisterRoute(call: PluginCall) {
        implementation.unregisterRoute(call.data)
        call.resolve()
    }

    @PluginMethod
    fun clearRoutes(call: PluginCall) {
        implementation.clearRoutes()
        call.resolve()
    }

    @PluginMethod
    fun respond(call: PluginCall) {
        try {
            implementation.respond(call.data)
            call.resolve()
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun completeJob(call: PluginCall) {
        try {
            call.resolve(implementation.completeJob(call.data))
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun failJob(call: PluginCall) {
        try {
            call.resolve(implementation.failJob(call.data))
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun getJob(call: PluginCall) {
        try {
            call.resolve(implementation.getJob(call.data))
        } catch (error: Exception) {
            call.reject(error.message, error)
        }
    }

    @PluginMethod
    fun listJobs(call: PluginCall) {
        call.resolve(implementation.listJobs(call.data))
    }

    @PluginMethod
    fun deleteJob(call: PluginCall) {
        implementation.deleteJob(call.data)
        call.resolve()
    }

    @PluginMethod
    fun mockRequest(call: PluginCall) {
        pluginScope.launch {
            try {
                val response = implementation.mockRequest(call.data)
                withContext(Dispatchers.Main) {
                    call.resolve(response)
                }
            } catch (error: Exception) {
                withContext(Dispatchers.Main) {
                    call.reject(error.message, error)
                }
            }
        }
    }

    override fun emit(
        eventName: String,
        payload: JSObject,
    ) {
        notifyListeners(eventName, payload)
    }
}
