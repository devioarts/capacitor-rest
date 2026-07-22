export const pluginSettings = {
  pluginClass: 'CapacitorREST',
  pluginMethods: [
    'start',
    'stop',
    'getInfo',
    'registerRoute',
    'unregisterRoute',
    'clearRoutes',
    'respond',
    'completeJob',
    'failJob',
    'getJob',
    'listJobs',
    'deleteJob',
    'mockRequest',
  ] as const,
  pluginEvents: ['request', 'started', 'stopped', 'error', 'jobUpdated'] as const,
} as const;

export type PluginSettings = typeof pluginSettings;
