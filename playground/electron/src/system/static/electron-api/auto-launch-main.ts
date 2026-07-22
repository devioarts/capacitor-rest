// window.Electron.autoLaunch bridge backed by Electron login item settings.
import { app } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';

function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

trustedIpcHandle('autoLaunch:isEnabled', () => isSupportedPlatform() && app.getLoginItemSettings().openAtLogin);

trustedIpcHandle('autoLaunch:setEnabled', (_e, enabled: boolean) => {
  if (!isSupportedPlatform()) return false;
  app.setLoginItemSettings({ openAtLogin: enabled === true });
  return app.getLoginItemSettings().openAtLogin;
});

trustedIpcHandle('autoLaunch:getSettings', () => app.getLoginItemSettings());
