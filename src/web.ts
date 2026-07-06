import { WebPlugin } from '@capacitor/core';

import type { CapacitorRESTPlugin } from './definitions';

export class CapacitorRESTWeb extends WebPlugin implements CapacitorRESTPlugin {
  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }
}
