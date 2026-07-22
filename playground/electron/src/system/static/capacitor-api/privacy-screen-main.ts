// Electron implementation of @capacitor/privacy-screen
import { app, BrowserWindow } from 'electron';
import { registerPlugin, type AnyRecord } from '../../shared/functions';

let enabled = false;

function applyContentProtection(flag: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setContentProtection(flag);
  }
}

app.on('browser-window-created', (_event, win) => {
  if (enabled) win.setContentProtection(true);
});

/**
 * Desktop privacy protection is necessarily OS-dependent. Electron's
 * BrowserWindow.setContentProtection maps to native capture-prevention APIs
 * where the platform supports them. It is strong on some OS/window-manager
 * combinations and advisory/no-op on others, so docs must describe it as a
 * mitigation rather than a guarantee.
 */
class PrivacyScreen {
  async enable(): Promise<{ success: boolean }> {
    enabled = true;
    applyContentProtection(true);
    return { success: true };
  }

  async disable(): Promise<{ success: boolean }> {
    enabled = false;
    applyContentProtection(false);
    return { success: true };
  }

  async isEnabled(): Promise<{ enabled: boolean }> {
    return { enabled };
  }
}

registerPlugin('PrivacyScreen', new PrivacyScreen() as unknown as AnyRecord, ['enable', 'disable', 'isEnabled']);
