// Electron implementation of @capacitor/network
import { net } from 'electron';
import { emitPluginEvent, registerPlugin, type AnyRecord, type EventHooks } from '../../shared/functions';

type ConnectionStatus = { connected: boolean; connectionType: 'wifi' | 'cellular' | 'none' | 'unknown' };

let currentStatus: ConnectionStatus | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function getNetworkStatus(): ConnectionStatus {
  const connected = net.isOnline();
  return { connected, connectionType: connected ? 'unknown' : 'none' };
}

export function sameStatus(a: ConnectionStatus | null, b: ConnectionStatus): boolean {
  return !!a && a.connected === b.connected && a.connectionType === b.connectionType;
}

function pollAndEmit(force = false): void {
  const next = getNetworkStatus();
  if (force || !sameStatus(currentStatus, next)) {
    currentStatus = next;
    emitPluginEvent('Network', 'networkStatusChange', next);
  }
}

function startNetworkPolling(): void {
  if (pollTimer) return;
  pollAndEmit(true);
  // Electron exposes main-process network status as net.isOnline(), not as
  // app-level online/offline events. Poll only while renderers are listening.
  pollTimer = setInterval(() => { pollAndEmit(false); }, 10_000);
}

function stopNetworkPolling(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

class Network {
  getStatus(): ConnectionStatus {
    currentStatus = getNetworkStatus();
    return currentStatus;
  }
}

const events: EventHooks = {
  networkStatusChange: { onAdd: startNetworkPolling, onRemove: stopNetworkPolling },
};

registerPlugin('Network', new Network() as unknown as AnyRecord, ['getStatus'], events);
