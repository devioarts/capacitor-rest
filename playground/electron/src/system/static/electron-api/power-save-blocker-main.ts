// window.Electron powerSaveBlocker bridge with small validation around blocker ids and types.
import { powerSaveBlocker } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';
import type { PowerSaveBlockerType } from '../../shared/types';

const blockerTypes = new Set<PowerSaveBlockerType>([
  'prevent-app-suspension',
  'prevent-display-sleep',
]);

function assertBlockerType(type: unknown): asserts type is PowerSaveBlockerType {
  if (!blockerTypes.has(type as PowerSaveBlockerType)) {
    throw new Error(`Invalid powerSaveBlocker type: ${String(type)}`);
  }
}

function assertBlockerId(id: unknown): asserts id is number {
  if (!Number.isInteger(id) || (id as number) < 0) {
    throw new Error(`Invalid powerSaveBlocker id: ${String(id)}`);
  }
}

trustedIpcHandle('powerSaveBlocker:start', (_, type: PowerSaveBlockerType) => {
  assertBlockerType(type);
  return powerSaveBlocker.start(type);
});

trustedIpcHandle('powerSaveBlocker:stop', (_, id: number) => {
  assertBlockerId(id);
  return powerSaveBlocker.stop(id);
});

trustedIpcHandle('powerSaveBlocker:isStarted', (_, id: number) => {
  assertBlockerId(id);
  return powerSaveBlocker.isStarted(id);
});
