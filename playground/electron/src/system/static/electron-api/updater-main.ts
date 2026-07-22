// Optional electron-updater integration exposed through window.Electron.updater.
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { trustedIpcHandle } from '../../shared/functions';
import type { ElectronConfig } from '../../shared/types';

// Variant B: exposed via window.Electron.updater namespace.
// Chosen over a Capacitor pseudo-plugin (Variant A) because the updater is
// platform infrastructure, not application logic, and fits alongside the
// existing system:* IPC layer that backs window.Electron.

/**
 * Configure `electron-updater` and wire up the IPC bridge for `window.Electron.updater`.
 *
 * Only active in packaged builds (`app.isPackaged === true`) when
 * `cfg.app.autoUpdater.enabled === true`. In all other cases, no-op IPC handlers
 * are registered so renderer calls (`checkForUpdate`, etc.) silently succeed
 * instead of rejecting with "no handler" errors.
 *
 * Updater errors are caught and logged — they never crash the main process.
 *
 * @param cfg  Electron platform config.
 */
export function setupUpdater(cfg: ElectronConfig): void {
  const updaterConfig = cfg.app?.autoUpdater;
  const active = app.isPackaged && updaterConfig?.enabled === true;

  if (!active) {
    // Register no-op handlers so renderer calls don't reject with "no handler" error
    trustedIpcHandle('updater:checkForUpdate', () => {});
    trustedIpcHandle('updater:downloadUpdate', () => {});
    trustedIpcHandle('updater:quitAndInstall', () => {});
    return;
  }

  const uc = updaterConfig!;

  try {
    autoUpdater.channel              = uc.channel          ?? 'latest';
    autoUpdater.autoDownload         = uc.autoDownload      ?? false;
    autoUpdater.autoInstallOnAppQuit = uc.autoInstallOnQuit ?? true;
    autoUpdater.allowPrerelease      = uc.allowPrerelease   ?? false;
    autoUpdater.allowDowngrade       = uc.allowDowngrade    ?? false;

    function broadcast(type: string, data?: unknown): void {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('updater:event', { type, data });
        }
      }
    }

    autoUpdater.on('checking-for-update',  ()         => broadcast('checking-for-update'));
    autoUpdater.on('update-available',     (info)     => broadcast('update-available', info));
    autoUpdater.on('update-not-available', (info)     => broadcast('update-not-available', info));
    autoUpdater.on('download-progress',    (progress) => broadcast('download-progress', progress));
    autoUpdater.on('update-downloaded',    (info)     => broadcast('update-downloaded', info));
    autoUpdater.on('error',                (err)      => broadcast('error', { message: err?.message ?? String(err) }));

    trustedIpcHandle('updater:checkForUpdate', () => { autoUpdater.checkForUpdates().catch(() => {}); });
    trustedIpcHandle('updater:downloadUpdate', () => { autoUpdater.downloadUpdate().catch(() => {}); });
    trustedIpcHandle('updater:quitAndInstall', () => { autoUpdater.quitAndInstall(); });
  } catch (err) {
    // updater errors are non-fatal — main process continues normally
    console.error('[updater] setup failed:', err);
  }
}
