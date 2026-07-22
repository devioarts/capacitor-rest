import type { PluginListenerHandle } from '@capacitor/core';
import type { CapacitorRESTPlugin, PluginPlatform, RestRequestHandler } from './definitions';
export declare function getPluginPlatform(): PluginPlatform;
declare const CapacitorREST: CapacitorRESTPlugin;
export declare function handleRequests(handler: RestRequestHandler): Promise<PluginListenerHandle>;
export * from './definitions';
export { CapacitorREST };
