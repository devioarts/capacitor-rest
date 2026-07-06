import { registerPlugin } from '@capacitor/core';

import type { CapacitorRESTPlugin } from './definitions';

const CapacitorREST = registerPlugin<CapacitorRESTPlugin>('CapacitorREST', {
  web: () => import('./web').then((m) => new m.CapacitorRESTWeb()),
});

export * from './definitions';
export { CapacitorREST };
