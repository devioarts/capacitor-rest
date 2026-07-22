import { Capacitor, registerPlugin } from '@capacitor/core';
export function getPluginPlatform() {
    return Capacitor.getPlatform();
}
const CapacitorRESTBridge = registerPlugin('CapacitorREST', {
    web: () => import('./web').then((m) => new m.CapacitorRESTWeb()),
});
const CapacitorREST = {
    start: (options) => CapacitorRESTBridge.start(options),
    stop: () => CapacitorRESTBridge.stop(),
    getInfo: () => CapacitorRESTBridge.getInfo(),
    getPluginPlatform,
    registerRoute: (options) => CapacitorRESTBridge.registerRoute(options),
    unregisterRoute: (options) => CapacitorRESTBridge.unregisterRoute(options),
    clearRoutes: () => CapacitorRESTBridge.clearRoutes(),
    respond: (options) => CapacitorRESTBridge.respond(options),
    completeJob: (options) => CapacitorRESTBridge.completeJob(options),
    failJob: (options) => CapacitorRESTBridge.failJob(options),
    getJob: (options) => CapacitorRESTBridge.getJob(options),
    listJobs: (options) => CapacitorRESTBridge.listJobs(options),
    deleteJob: (options) => CapacitorRESTBridge.deleteJob(options),
    mockRequest: (options) => CapacitorRESTBridge.mockRequest(options),
    addListener: CapacitorRESTBridge.addListener.bind(CapacitorRESTBridge),
};
export async function handleRequests(handler) {
    return CapacitorREST.addListener('request', async (request) => {
        try {
            const response = await handler(request);
            if (request.jobId) {
                const { jobId } = request;
                await settleRequest(() => CapacitorREST.completeJob({
                    jobId,
                    response,
                }));
                return;
            }
            await settleRequest(() => CapacitorREST.respond(Object.assign({ requestId: request.id }, response)));
        }
        catch (error) {
            if (request.jobId) {
                const { jobId } = request;
                await settleRequest(() => CapacitorREST.failJob({
                    jobId,
                    error: error instanceof Error ? error.message : String(error),
                }));
                return;
            }
            await settleRequest(() => CapacitorREST.respond({
                requestId: request.id,
                status: 500,
                bodyType: 'json',
                body: {
                    error: error instanceof Error ? error.message : String(error),
                },
            }));
        }
    });
}
async function settleRequest(action) {
    try {
        await action();
    }
    catch (_a) {
        // A sync HTTP request may already have timed out, or an async job may have
        // been deleted before the JavaScript handler settles. The HTTP side has
        // already returned the appropriate terminal response in that case.
    }
}
export * from './definitions';
export { CapacitorREST };
//# sourceMappingURL=index.js.map