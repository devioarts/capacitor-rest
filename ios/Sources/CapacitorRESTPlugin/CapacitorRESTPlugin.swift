import Foundation
import Capacitor

@objc(CapacitorRESTPlugin)
public class CapacitorRESTPlugin: CAPPlugin, CAPBridgedPlugin, RestServerBridge {
    public let identifier = "CapacitorRESTPlugin"
    public let jsName = "CapacitorREST"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregisterRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearRoutes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "respond", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completeJob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "failJob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getJob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listJobs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteJob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mockRequest", returnType: CAPPluginReturnPromise)
    ]
    private lazy var implementation = CapacitorREST(bridge: self)

    @objc func start(_ call: CAPPluginCall) {
        do {
            call.resolve(try implementation.start(options: call.jsObjectRepresentation))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        implementation.stop()
        call.resolve()
    }

    @objc func getInfo(_ call: CAPPluginCall) {
        call.resolve(implementation.getInfo())
    }

    @objc func registerRoute(_ call: CAPPluginCall) {
        do {
            call.resolve(try implementation.registerRoute(options: call.jsObjectRepresentation))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func unregisterRoute(_ call: CAPPluginCall) {
        implementation.unregisterRoute(options: call.jsObjectRepresentation)
        call.resolve()
    }

    @objc func clearRoutes(_ call: CAPPluginCall) {
        implementation.clearRoutes()
        call.resolve()
    }

    @objc func respond(_ call: CAPPluginCall) {
        do {
            try implementation.respond(options: call.jsObjectRepresentation)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func completeJob(_ call: CAPPluginCall) {
        do {
            call.resolve(try implementation.completeJob(options: call.jsObjectRepresentation))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func failJob(_ call: CAPPluginCall) {
        do {
            call.resolve(try implementation.failJob(options: call.jsObjectRepresentation))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func getJob(_ call: CAPPluginCall) {
        do {
            call.resolve(try implementation.getJob(options: call.jsObjectRepresentation))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func listJobs(_ call: CAPPluginCall) {
        call.resolve(implementation.listJobs(options: call.jsObjectRepresentation))
    }

    @objc func deleteJob(_ call: CAPPluginCall) {
        implementation.deleteJob(options: call.jsObjectRepresentation)
        call.resolve()
    }

    @objc func mockRequest(_ call: CAPPluginCall) {
        implementation.mockRequest(options: call.jsObjectRepresentation) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let response):
                    call.resolve(response)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    func emit(_ eventName: String, _ payload: JSObject) {
        notifyListeners(eventName, data: payload)
    }
}
