// Electron implementation of @capacitor/app
import { app, BrowserWindow } from 'electron';
import { registerPlugin, emitPluginEvent, loadConfig, getMainWindow, onMainWindowChanged, type AnyRecord, type EventHooks } from '../../shared/functions';
import { consumeLaunchUrl } from '../electron-api/deep-link-main';

function parseLaunchUrl(): string | undefined {
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  const deepLink = argv.find(a => /^[a-z][a-z0-9+\-.]*:\/\//i.test(a) && !a.startsWith('http'));
  // Intentionally NOT falling back to webContents.getURL() - getLaunchUrl() must
  // return undefined on a normal launch (no deep link), matching Capacitor's
  // documented behaviour.
  return deepLink;
}

let fallbackLaunchUrlConsumed = false;

// ── Plugin class ──────────────────────────────────────────────────────────────

/**
 * Electron implementation of the Capacitor App plugin.
 *
 * `appStateChange`, `resume`, and `pause` are emitted via focus/blur window events.
 * `appUrlOpen` is forwarded from the deep-link system (deep-link-main.ts emits it).
 * `backButton` is a no-op on desktop.
 * `minimizeApp` maps to `win.minimize()` — Android-only in Capacitor but sensible on desktop.
 */
class App {
  async getInfo(): Promise<{ id: string; name: string; build: string; version: string }> {
    const { appCfg } = loadConfig();
    const id      = appCfg.appId ?? app.getName();
    const version = app.getVersion();
    return { id, name: app.getName(), build: version, version };
  }

  async getState(): Promise<{ isActive: boolean }> {
    const win = getMainWindow();
    return { isActive: !!win && !win.isMinimized() && win.isFocused() };
  }

  async exitApp(): Promise<void> { app.quit(); }

  async minimizeApp(): Promise<void> { getMainWindow()?.minimize(); }

  async getLaunchUrl(): Promise<{ url: string } | undefined> {
    const url = consumeLaunchUrl() ?? (fallbackLaunchUrlConsumed ? undefined : parseLaunchUrl());
    fallbackLaunchUrlConsumed = true;
    return url ? { url } : undefined;
  }

  async getAppLanguage(): Promise<{ value: string }> {
    const tag = app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
    return { value: tag.split(/[-_]/)[0] || tag };
  }

  async toggleBackButtonHandler(): Promise<void> {}
}

// ── Window event hooks ────────────────────────────────────────────────────────
// Shared ref-count so appStateChange, resume, and pause share one pair of
// focus/blur handlers — each type independently adds/removes the listener.

let listenCount  = 0;
let focusHandler: (() => void) | null = null;
let blurHandler:  (() => void) | null = null;
let listenedWindow: BrowserWindow | null = null;
let closeHandler: (() => void) | null = null;

function attachToWindow(win = getMainWindow()): void {
  if (!win || focusHandler || listenCount === 0) return;
  listenedWindow = win;
  closeHandler = () => {
    if (listenedWindow === win) {
      focusHandler = null;
      blurHandler = null;
      closeHandler = null;
      listenedWindow = null;
    }
  };
  win.once('closed', closeHandler);
  focusHandler = () => {
    emitPluginEvent('App', 'appStateChange', { isActive: true });
    emitPluginEvent('App', 'resume');
  };
  blurHandler = () => {
    emitPluginEvent('App', 'appStateChange', { isActive: false });
    emitPluginEvent('App', 'pause');
  };
  win.on('focus', focusHandler);
  win.on('blur',  blurHandler);
}

function attachWindowListeners(): void {
  listenCount++;
  if (listenCount !== 1) return;
  attachToWindow();
}

function detachFromWindow(): void {
  const win = listenedWindow;
  if (!win) return;
  if (focusHandler) win.removeListener('focus', focusHandler);
  if (blurHandler)  win.removeListener('blur',  blurHandler);
  if (closeHandler) win.removeListener('closed', closeHandler);
  focusHandler = null;
  blurHandler  = null;
  closeHandler = null;
  listenedWindow = null;
}

function detachWindowListeners(): void {
  if (listenCount === 0) return;
  if (--listenCount > 0) return;
  detachFromWindow();
}

onMainWindowChanged((win) => {
  if (listenedWindow && listenedWindow !== win) detachFromWindow();
  attachToWindow(win ?? undefined);
});

const events: EventHooks = {
  appStateChange: { onAdd: attachWindowListeners, onRemove: detachWindowListeners },
  resume:         { onAdd: attachWindowListeners, onRemove: detachWindowListeners },
  pause:          { onAdd: attachWindowListeners, onRemove: detachWindowListeners },
  appUrlOpen:     {},  // emitted from deep-link-main.ts via emitPluginEvent('App', 'appUrlOpen')
  appRestoredResult: {}, // no-op on desktop; Android activity result restoration has no Electron equivalent
  backButton:     {},  // no-op on desktop
};

registerPlugin(
  'App',
  new App() as unknown as AnyRecord,
  ['getInfo', 'getState', 'exitApp', 'minimizeApp', 'getLaunchUrl', 'getAppLanguage', 'toggleBackButtonHandler'],
  events,
);
