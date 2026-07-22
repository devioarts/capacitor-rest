// Auto-generated — do not edit.
// Regenerate with: cap-electron sync

import { app } from 'electron';
import { registerPlugin, AnyRecord } from '../shared/functions';
import { CapacitorREST } from "@devioarts/capacitor-rest/electron";

void (async () => {
  await app.whenReady();
  registerPlugin("CapacitorREST", new CapacitorREST() as unknown as AnyRecord, ["start","stop","getInfo","registerRoute","unregisterRoute","clearRoutes","respond","completeJob","failJob","getJob","listJobs","deleteJob","mockRequest"]);
})();
