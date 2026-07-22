// Power monitor event broadcaster and idle-state bridge for window.Electron.
import { powerMonitor, BrowserWindow } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';
import type { PowerMonitorEventName } from '../../shared/types';

function broadcast(type: PowerMonitorEventName): void {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('powerMonitor:event', { type });
  });
}

powerMonitor.on('suspend',       () => broadcast('suspend'));
powerMonitor.on('resume',        () => broadcast('resume'));
powerMonitor.on('lock-screen',   () => broadcast('lock-screen'));
powerMonitor.on('unlock-screen', () => broadcast('unlock-screen'));
powerMonitor.on('on-battery',    () => broadcast('on-battery'));
powerMonitor.on('on-ac',         () => broadcast('on-ac'));
powerMonitor.on('shutdown',      () => broadcast('shutdown'));

trustedIpcHandle('powerMonitor:getSystemIdleState', (_, seconds: number) =>
  powerMonitor.getSystemIdleState(seconds),
);
trustedIpcHandle('powerMonitor:getSystemIdleTime', () =>
  powerMonitor.getSystemIdleTime(),
);
