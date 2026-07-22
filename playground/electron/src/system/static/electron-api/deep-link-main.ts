// Deep-link registration, cold-start URL capture, and renderer/App plugin event delivery.
import { app, BrowserWindow } from 'electron';
import { emitPluginEvent } from '../../shared/functions';

let _pending: string | null = null;
let _launchUrl: string | null = null;
const MAX_DEEP_LINK_URL_LENGTH = 8192;

function urlFromArgv(argv: string[], scheme: string): string | undefined {
  for (const arg of argv) {
    const normalized = normalizeDeepLinkUrl(arg, scheme);
    if (normalized) return normalized;
  }
  return undefined;
}

export function normalizeDeepLinkUrl(rawUrl: string, scheme: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_DEEP_LINK_URL_LENGTH) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${scheme}:` ? url.href : null;
  } catch {
    return null;
  }
}

function forward(url: string, getWin: () => BrowserWindow | null): void {
  const win = getWin();
  if (!win || win.isDestroyed()) {
    _pending = url;
    return;
  }
  _pending = null;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  win.webContents.send('deepLink', { url });
  emitPluginEvent('App', 'appUrlOpen', { url });
}

function rememberLaunchUrl(url: string): void {
  if (_launchUrl === null) _launchUrl = url;
}

export function consumeLaunchUrl(): string | null {
  const url = _launchUrl;
  _launchUrl = null;
  return url;
}

/** Register the protocol and event listeners. Call before app.whenReady(). */
export function setupDeepLinking(scheme: string, getWin: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    console.warn(`[deep-link] Registering '${scheme}://' protocol in dev mode`);
  }

  app.setAsDefaultProtocolClient(scheme);

  // macOS: system fires open-url when the app is launched via protocol URL
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const normalized = normalizeDeepLinkUrl(url, scheme);
    if (!normalized) return;
    if (!app.isReady()) rememberLaunchUrl(normalized);
    forward(normalized, getWin);
  });

  // Windows second-instance: the deep link URL is passed as a CLI argument.
  // Also handles plain second-instance launch (no URL) — restore + focus.
  app.on('second-instance', (_event, argv) => {
    const url = urlFromArgv(argv, scheme);
    if (url) {
      forward(url, getWin);
    } else {
      const win = getWin();
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    }
  });

  // Intentionally NOT calling removeAsDefaultProtocolClient on quit —
  // removing it on normal exit would break OS protocol associations for cold starts.
}

/**
 * Handle startup URLs passed via argv and flush any URL that arrived before the window was ready.
 * Call after createWindow() inside app.whenReady().
 */
export function flushDeepLink(scheme: string, getWin: () => BrowserWindow | null): void {
  if (process.platform === 'win32' || process.platform === 'linux') {
    const url = urlFromArgv(process.argv, scheme);
    if (url) { rememberLaunchUrl(url); forward(url, getWin); return; }
  }
  if (_pending) forward(_pending, getWin);
}
