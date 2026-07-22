// Splash screen helper that shows a frameless loading window until the main window is ready.
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import type { ElectronConfig } from '../../shared/types';

/**
 * Create a splash-screen window and return a callback that closes it.
 *
 * The splash is a frameless, always-on-top, centered window that displays `cfg.ui.splashScreen.image`.
 * The image is served via an app-specific HTML file that references it as a
 * file:// URL so Chromium loads it directly from disk — no base64 overhead.
 *
 * Returns `null` when `cfg.ui.splashScreen` is not configured or has no `image` path.
 *
 * @param cfg  Electron platform config read from `capacitor.config.json`.
 * @returns    A `hideSplash(onClosed?)` function, or `null` if the splash is disabled.
 */
export function setupSplash(cfg: ElectronConfig): ((onClosed?: () => void) => void) | null {
  if (!cfg.ui?.splashScreen) return null;

  const {
    width = 400,
    height = 300,
    backgroundColor = '#ffffff',
    image,
    minDisplayTime = 0,
  } = cfg.ui.splashScreen;

  if (!image) return null;

  const abs = path.join(__dirname, '..', 'assets', image);
  if (!fs.existsSync(abs)) return null;

  const bg = normalizeBackgroundColor(backgroundColor);

  // Stable app-specific filename avoids accumulating files and avoids collisions
  // with other Electron apps that may launch at the same time.
  // Write only when content has changed (e.g. different image or color after a config update).
  const htmlPath = path.join(app.getPath('userData'), 'CapacitorElectron', 'splash.html');
  const htmlContent = buildHTML(pathToFileURL(abs).href);
  try {
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    const existing = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : null;
    if (existing !== htmlContent) fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  } catch {
    return null;
  }

  const splash = new BrowserWindow({
    width,
    height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    resizable: false,
    focusable: false,
    transparent: bg === 'transparent',
    backgroundColor: bg === 'transparent' ? '#00000000' : bg,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  splash.setBackgroundColor(bg === 'transparent' ? '#00000000' : bg);
  splash.loadFile(htmlPath);

  const shownAt = Date.now();

  return function hideSplash(onClosed?: () => void): void {
    const remaining = minDisplayTime - (Date.now() - shownAt);
    const close = () => {
      if (!splash.isDestroyed()) splash.close();
      onClosed?.();
    };
    if (remaining > 0) setTimeout(close, remaining);
    else close();
  };
}

function normalizeBackgroundColor(value: string): string {
  const color = String(value ?? '').trim();
  if (/^transparent$/i.test(color)) return 'transparent';
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color;
  if (/^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  if (/^hsla?\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  return '#ffffff';
}

export function escapeHtmlAttr(value: string): string {
  return value.replace(/[&"]/g, (ch) => ch === '&' ? '&amp;' : '&quot;');
}

function buildHTML(imageUrl: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;background:transparent;overflow:hidden"><img src="${escapeHtmlAttr(imageUrl)}" style="max-width:100%;max-height:100%;object-fit:contain"></body></html>`;
}
