// window.Electron screen/display bridge plus display change event broadcasting.
import { screen, BrowserWindow, app } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';
import type { ScreenEventName } from '../../shared/types';

function broadcast(type: ScreenEventName, data: unknown): void {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('screen:event', { type, data });
  });
}

// screen can only be used after app is ready — these handlers are only invoked
// from the renderer, which loads after ready, so direct access is safe here
trustedIpcHandle('screen:getAllDisplays',    () => screen.getAllDisplays());
trustedIpcHandle('screen:getPrimaryDisplay', () => screen.getPrimaryDisplay());
trustedIpcHandle('screen:getCursorScreenPoint', () => screen.getCursorScreenPoint());
trustedIpcHandle('screen:getCursorDisplay', () => {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point);
});

app.whenReady().then(() => {
  screen.on('display-added',           (_, d) => broadcast('display-added', d));
  screen.on('display-removed',         (_, d) => broadcast('display-removed', d));
  screen.on('display-metrics-changed', (_, d, changedMetrics) =>
    broadcast('display-metrics-changed', { display: d, changedMetrics }),
  );
});
