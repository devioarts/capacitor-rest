'use strict';

const pluginSettings = {
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
    ],
    pluginEvents: ['request', 'started', 'stopped', 'error', 'jobUpdated'],
};

exports.pluginSettings = pluginSettings;
//# sourceMappingURL=plugin-settings.js.map
