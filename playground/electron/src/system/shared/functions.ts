// Shared main-process utilities for trusted IPC, config loading, and Capacitor plugin registration.
import { ipcMain, BrowserWindow } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppConfig, ElectronConfig } from './types';

export type AnyRecord = Record<string, unknown>;
export type EventHooks = Record<string, { onAdd?: () => void; onRemove?: () => void }>;

// IPC sender trust filter — default allows all (backwards-compatible).
// Override with setIpcSenderCheck() from main.ts once the app URL is known.
let _senderCheck: ((url: string) => boolean) | null = null;
let _mainWindow: BrowserWindow | null = null;
const _mainWindowListeners = new Set<(win: BrowserWindow | null) => void>();

/**
 * Restrict all plugin IPC handlers to frames whose URL satisfies `fn`.
 * Call this from main.ts after the loaded URL is known (dev URL, file://, or local server origin).
 * Frames that fail the check receive a FORBIDDEN error instead of being dispatched.
 */
export function setIpcSenderCheck(fn: (url: string) => boolean): void {
  _senderCheck = fn;
}

function ipcSenderUrl(event: IpcMainInvokeEvent | IpcMainEvent): string {
  return event.senderFrame?.url ?? '';
}

export function isIpcSenderTrusted(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return !_senderCheck || _senderCheck(ipcSenderUrl(event));
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent, channel: string): void {
  if (isIpcSenderTrusted(event)) return;
  const err = new Error(`IPC sender not trusted for ${channel}`);
  (err as Error & { code?: string }).code = 'FORBIDDEN';
  throw err;
}

/**
 * Register a system IPC handler protected by the same sender-origin check as
 * plugin IPC. Keep all window.Electron.* channels on this wrapper so a preload
 * accidentally attached to untrusted content cannot call privileged main APIs.
 */
export function trustedIpcHandle<T extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, channel);
    return listener(event, ...(args as T));
  });
}

export function trustedIpcOn<T extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: T) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isIpcSenderTrusted(event)) return;
    listener(event, ...(args as T));
  });
}

export function trustedIpcOnSync<T extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: T) => unknown,
): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isIpcSenderTrusted(event)) {
      event.returnValue = false;
      return;
    }

    try {
      event.returnValue = listener(event, ...(args as T));
    } catch {
      event.returnValue = false;
    }
  });
}

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win && !win.isDestroyed() ? win : null;
  for (const listener of _mainWindowListeners) listener(_mainWindow);
}

export function getMainWindow(): BrowserWindow | null {
  return _mainWindow && !_mainWindow.isDestroyed() ? _mainWindow : null;
}

export function onMainWindowChanged(listener: (win: BrowserWindow | null) => void): () => void {
  _mainWindowListeners.add(listener);
  return () => { _mainWindowListeners.delete(listener); };
}

function isPlainObject(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Broadcast an event from a plugin to all renderer windows.
 *
 * Safe to call before any window exists — the loop over `BrowserWindow.getAllWindows()`
 * simply runs zero iterations in that case.
 *
 * @param pluginClass  Class name of the plugin (e.g. `'MyPlugin'`).
 * @param eventType    Event name matching one of the plugin's declared `pluginEvents`.
 * @param data         Optional payload forwarded verbatim to the renderer listener.
 */
export function emitPluginEvent(pluginClass: string, eventType: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(`event-${pluginClass}-${eventType}`, data);
    }
  }
}

/**
 * Register a plugin's IPC handlers in the main process.
 *
 * For each method in `methods`, registers an `ipcMain.handle` handler on the
 * channel `{pluginClass}-{method}`. The options argument must be a plain JSON
 * object; errors thrown by the implementation are caught and returned as a
 * structured `{ success: false, error }` object so the renderer can inspect them.
 *
 * When `events` is provided, registers `event-add-{pluginClass}` and
 * `event-remove-{pluginClass}-{type}` listeners used by the preload to start
 * and stop lazy event sources (e.g. hardware sensors, file watchers).
 *
 * @param pluginClass  Class name used as the IPC channel prefix.
 * @param instance     Plugin instance whose methods are invoked by the handlers.
 * @param methods      Method names to expose via IPC.
 * @param events       Optional lifecycle hooks for lazy event sources.
 */
export function registerPlugin(pluginClass: string, instance: AnyRecord, methods: readonly string[], events?: EventHooks): void {
  for (const method of methods) {
    ipcMain.handle(`${pluginClass}-${method}`, async (event, opts: unknown) => {
      const senderUrl = event.senderFrame?.url ?? '';
      if (_senderCheck && !_senderCheck(senderUrl)) {
        return { success: false, error: { code: 'FORBIDDEN', message: 'IPC sender not trusted', platform: 'electron', method, details: {} } };
      }
      if (!isPlainObject(opts) && opts !== undefined) {
        return { success: false, error: { code: 'INVALID_PARAMS', message: 'Options must be a plain object', platform: 'electron', method, details: {} } };
      }
      try {
        return await (instance[method] as (opts: AnyRecord) => Promise<unknown>)((opts ?? {}) as AnyRecord);
      } catch (err) {
        return { success: false, error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err), platform: 'electron', method, details: {} } };
      }
    });
  }

  if (events && Object.keys(events).length > 0) {
    const listenerCounts = new Map<string, Map<number, number>>();
    const webContentsById = new Map<number, WebContents>();

    const totalListeners = (type: string): number => {
      let total = 0;
      for (const count of listenerCounts.get(type)?.values() ?? []) total += count;
      return total;
    };

    const cleanupWebContents = (wcId: number): void => {
      for (const [type, perWindow] of listenerCounts) {
        const before = totalListeners(type);
        if (!perWindow.delete(wcId)) continue;
        if (perWindow.size === 0) listenerCounts.delete(type);
        if (before > 0 && totalListeners(type) === 0) events[type]?.onRemove?.();
      }
      webContentsById.delete(wcId);
    };

    const trackWebContents = (wc: WebContents): void => {
      if (webContentsById.has(wc.id)) return;
      webContentsById.set(wc.id, wc);
      wc.once('destroyed', () => cleanupWebContents(wc.id));
    };

    ipcMain.on(`event-add-${pluginClass}`, (event, type: string) => {
      if (!isIpcSenderTrusted(event)) return;
      if (!events[type]) return;
      const wc = event.sender;
      const before = totalListeners(type);
      let perWindow = listenerCounts.get(type);
      if (!perWindow) {
        perWindow = new Map<number, number>();
        listenerCounts.set(type, perWindow);
      }
      trackWebContents(wc);
      perWindow.set(wc.id, (perWindow.get(wc.id) ?? 0) + 1);
      if (before === 0) events[type]?.onAdd?.();
    });
    for (const [type, hooks] of Object.entries(events)) {
      ipcMain.on(`event-remove-${pluginClass}-${type}`, (event) => {
        if (!isIpcSenderTrusted(event)) return;
        const perWindow = listenerCounts.get(type);
        if (!perWindow) return;

        const before = totalListeners(type);
        const wcId = event.sender.id;
        const next = (perWindow.get(wcId) ?? 0) - 1;
        if (next > 0) perWindow.set(wcId, next);
        else perWindow.delete(wcId);

        if (perWindow.size === 0) listenerCounts.delete(type);
        if (before > 0 && totalListeners(type) === 0) hooks.onRemove?.();
      });
    }
  }
}

/**
 * Read `capacitor.config.json` from the `electron/` directory and extract the
 * root app config and the `plugins.Electron` section.
 *
 * Returns empty objects when the file is absent or unparseable — this is expected
 * before `cap-electron sync` has been run for the first time.
 */
export function loadConfig(): { appCfg: AppConfig; cfg: ElectronConfig } {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'capacitor.config.json'), 'utf-8')
    ) as AppConfig;
    return { appCfg: raw, cfg: raw.plugins?.Electron ?? {} };
  } catch {
    return { appCfg: {}, cfg: {} };
  }
}
