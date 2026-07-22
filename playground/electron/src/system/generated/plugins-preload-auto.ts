// Auto-generated — do not edit.
// Regenerate with: cap-electron sync

export const pluginsAuto = {
  "CapacitorREST": {
    methods: ["start","stop","getInfo","registerRoute","unregisterRoute","clearRoutes","respond","completeJob","failJob","getJob","listJobs","deleteJob","mockRequest"],
    events: ["request","started","stopped","error","jobUpdated"],
  },
} as const;

export type PluginAutoRegistry = typeof pluginsAuto;
