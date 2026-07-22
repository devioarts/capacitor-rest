// Preload bridge that exposes the safe window.Electron desktop API to renderer code.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ElectronBridge, UpdaterBridge, UpdaterEventName, PowerMonitorEventName, PowerSaveBlockerType, ScreenEventPayload, DownloadState, NativeThemeSnapshot, MenuActionEvent, ContextMenuTarget, ShowContextMenuOptions } from '../../shared/types';

ipcRenderer.send('downloads:ensureSession');

window.addEventListener('contextmenu', (event) => {
  const payload = {
    x: Math.round(event.clientX),
    y: Math.round(event.clientY),
    target: contextMenuTarget(event),
  };

  try {
    ipcRenderer.sendSync('menu:contextTargetSync', payload);
  } catch {
    ipcRenderer.send('menu:contextTarget', payload);
  }
}, { capture: true });

const bridge: ElectronBridge = {
  quit:           ()                  => ipcRenderer.invoke('system:quit'),
  minimize:       ()                  => ipcRenderer.invoke('system:minimize'),
  maximize:       ()                  => ipcRenderer.invoke('system:maximize'),
  unmaximize:     ()                  => ipcRenderer.invoke('system:unmaximize'),
  toggleMaximize: ()                  => ipcRenderer.invoke('system:toggleMaximize'),
  isMaximized:    ()                  => ipcRenderer.invoke('system:isMaximized'),
  setFullscreen:  (flag: boolean)     => ipcRenderer.invoke('system:setFullscreen', flag),
  isFullscreen:   ()                  => ipcRenderer.invoke('system:isFullscreen'),
  focus:          ()                  => ipcRenderer.invoke('system:focus'),
  reload:         ()                  => ipcRenderer.invoke('system:reload'),
  openDevTools:   ()                  => ipcRenderer.invoke('system:openDevTools'),
  closeDevTools:  ()                  => ipcRenderer.invoke('system:closeDevTools'),
  getAppVersion:  ()                  => ipcRenderer.invoke('system:getAppVersion'),

  updater: {
    checkForUpdate: () => ipcRenderer.invoke('updater:checkForUpdate'),
    downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    on: (event: UpdaterEventName, callback: (data: unknown) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: { type: string; data: unknown }) => {
        if (payload.type === event) callback(payload.data);
      };
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
  } as UpdaterBridge,

  dialogs: {
    showOpenDialog: (options?: unknown) => ipcRenderer.invoke('dialogs:showOpenDialog', options),
    showSaveDialog: (options?: unknown) => ipcRenderer.invoke('dialogs:showSaveDialog', options),
    showMessageBox: (options: unknown) => ipcRenderer.invoke('dialogs:showMessageBox', options),
    showErrorBox: (options: { title?: string; content?: string }) => ipcRenderer.invoke('dialogs:showErrorBox', options),
  },

  secureStorage: {
    isEncryptionAvailable: () => ipcRenderer.invoke('secureStorage:isEncryptionAvailable'),
    getSelectedStorageBackend: () => ipcRenderer.invoke('secureStorage:getSelectedStorageBackend'),
    set: (key: string, value: string) => ipcRenderer.invoke('secureStorage:set', { key, value }),
    get: (key: string) => ipcRenderer.invoke('secureStorage:get', key),
    remove: (key: string) => ipcRenderer.invoke('secureStorage:remove', key),
    clear: () => ipcRenderer.invoke('secureStorage:clear'),
    keys: () => ipcRenderer.invoke('secureStorage:keys'),
    encryptString: (value: string) => ipcRenderer.invoke('secureStorage:encryptString', value),
    decryptString: (value: string) => ipcRenderer.invoke('secureStorage:decryptString', value),
  },

  protocols: {
    getConfiguredSchemes: () => ipcRenderer.invoke('protocol:getConfiguredSchemes'),
    isProtocolHandled: (scheme: string) => ipcRenderer.invoke('protocol:isProtocolHandled', scheme),
    isDefaultProtocolClient: (scheme: string) => ipcRenderer.invoke('protocol:isDefaultProtocolClient', scheme),
    setAsDefaultProtocolClient: (scheme: string) => ipcRenderer.invoke('protocol:setAsDefaultProtocolClient', scheme),
    removeAsDefaultProtocolClient: (scheme: string) => ipcRenderer.invoke('protocol:removeAsDefaultProtocolClient', scheme),
    openExternal: (url: string) => ipcRenderer.invoke('protocol:openExternal', url),
  },

  session: {
    clearCache: () => ipcRenderer.invoke('session:clearCache'),
    clearStorageData: (options?: unknown) => ipcRenderer.invoke('session:clearStorageData', options),
    getUserAgent: () => ipcRenderer.invoke('session:getUserAgent'),
    setUserAgent: (userAgent: string) => ipcRenderer.invoke('session:setUserAgent', userAgent),
    resolveProxy: (url: string) => ipcRenderer.invoke('session:resolveProxy', url),
    setProxy: (config: unknown) => ipcRenderer.invoke('session:setProxy', config),
    closeAllConnections: () => ipcRenderer.invoke('session:closeAllConnections'),
    getCookies: (filter?: unknown) => ipcRenderer.invoke('session:getCookies', filter),
    setCookie: (cookie: unknown) => ipcRenderer.invoke('session:setCookie', cookie),
    removeCookie: (options: { url: string; name: string }) => ipcRenderer.invoke('session:removeCookie', options),
  },

  downloads: {
    start: (options: { url: string; savePath?: string }) => ipcRenderer.invoke('downloads:start', options),
    pause: (id: string) => ipcRenderer.invoke('downloads:pause', id),
    resume: (id: string) => ipcRenderer.invoke('downloads:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
    getActive: () => ipcRenderer.invoke('downloads:getActive'),
    on: (callback: (event: { type: string; data: DownloadState }) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, event: { type: string; data: DownloadState }) => callback(event);
      ipcRenderer.on('downloads:event', listener);
      return () => ipcRenderer.removeListener('downloads:event', listener);
    },
  },

  print: {
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
    print: (options?: unknown) => ipcRenderer.invoke('print:print', options),
    printToPDF: (options?: { options?: unknown; path?: string }) => ipcRenderer.invoke('print:printToPDF', options),
  },

  desktopCapture: {
    getSources: (options?: { types?: Array<'window' | 'screen'>; thumbnailSize?: { width: number; height: number }; fetchWindowIcons?: boolean }) =>
      ipcRenderer.invoke('desktopCapture:getSources', options),
  },

  autoLaunch: {
    isEnabled: () => ipcRenderer.invoke('autoLaunch:isEnabled'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('autoLaunch:setEnabled', enabled),
    getSettings: () => ipcRenderer.invoke('autoLaunch:getSettings'),
  },

  nativeTheme: {
    get: () => ipcRenderer.invoke('nativeTheme:get'),
    setThemeSource: (source: NativeThemeSnapshot['themeSource']) => ipcRenderer.invoke('nativeTheme:setThemeSource', source),
    onUpdated: (callback: (data: NativeThemeSnapshot) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, data: NativeThemeSnapshot) => callback(data);
      ipcRenderer.on('nativeTheme:updated', listener);
      return () => ipcRenderer.removeListener('nativeTheme:updated', listener);
    },
  },

  windows: {
    create: (options?: unknown) => ipcRenderer.invoke('windows:create', options),
    list: () => ipcRenderer.invoke('windows:list'),
    focus: (id: number) => ipcRenderer.invoke('windows:focus', id),
    close: (id: number) => ipcRenderer.invoke('windows:close', id),
    show: (id: number) => ipcRenderer.invoke('windows:show', id),
    hide: (id: number) => ipcRenderer.invoke('windows:hide', id),
    setBounds: (id: number, bounds) => ipcRenderer.invoke('windows:setBounds', { id, bounds }),
    openExternal: (url: string) => ipcRenderer.invoke('windows:openExternal', url),
  },

  onDeepLink: (callback: (data: { url: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, data: { url: string }) => callback(data);
    ipcRenderer.on('deepLink', listener);
    return () => ipcRenderer.removeListener('deepLink', listener);
  },

  registerShortcut: (accelerator: string, event: string): Promise<boolean> =>
    ipcRenderer.invoke('shortcuts:register', { accelerator, event }),

  unregisterShortcut: (accelerator: string): Promise<void> =>
    ipcRenderer.invoke('shortcuts:unregister', accelerator),

  onShortcut: (callback: (data: { event: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, data: { event: string }) => callback(data);
    ipcRenderer.on('shortcut', listener);
    return () => ipcRenderer.removeListener('shortcut', listener);
  },

  showContextMenu: (options?: ShowContextMenuOptions): Promise<boolean> =>
    ipcRenderer.invoke('menu:showContextMenu', normalizeShowContextMenuOptions(options)),

  onMenuAction: (callback: (event: MenuActionEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, event: MenuActionEvent) => callback(event);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },

  // ── Badge count ─────────────────────────────────────────────────────────────
  setBadgeCount: (count: number): Promise<boolean> =>
    ipcRenderer.invoke('system:setBadgeCount', count),
  getBadgeCount: (): Promise<number> =>
    ipcRenderer.invoke('system:getBadgeCount'),

  // ── Power Monitor ───────────────────────────────────────────────────────────
  onPowerMonitorEvent: (callback: (data: { type: PowerMonitorEventName }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, data: { type: PowerMonitorEventName }) => callback(data);
    ipcRenderer.on('powerMonitor:event', listener);
    return () => ipcRenderer.removeListener('powerMonitor:event', listener);
  },
  getPowerMonitorIdleState: (idleThreshold: number) =>
    ipcRenderer.invoke('powerMonitor:getSystemIdleState', idleThreshold),
  getPowerMonitorIdleTime: () =>
    ipcRenderer.invoke('powerMonitor:getSystemIdleTime'),

  // ── Power Save Blocker ─────────────────────────────────────────────────────
  startPowerSaveBlocker: (type: PowerSaveBlockerType): Promise<number> =>
    ipcRenderer.invoke('powerSaveBlocker:start', type),
  stopPowerSaveBlocker: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('powerSaveBlocker:stop', id),
  isPowerSaveBlockerStarted: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('powerSaveBlocker:isStarted', id),

  // ── Screen / Display ────────────────────────────────────────────────────────
  getAllDisplays:      () => ipcRenderer.invoke('screen:getAllDisplays'),
  getPrimaryDisplay:   () => ipcRenderer.invoke('screen:getPrimaryDisplay'),
  getCursorScreenPoint:() => ipcRenderer.invoke('screen:getCursorScreenPoint'),
  getCursorDisplay:    () => ipcRenderer.invoke('screen:getCursorDisplay'),
  onScreenEvent: (callback: (data: ScreenEventPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, data: ScreenEventPayload) => callback(data);
    ipcRenderer.on('screen:event', listener);
    return () => ipcRenderer.removeListener('screen:event', listener);
  },

  onElectronError: (callback: (data: { message: string; stack: string | undefined; type: 'exception' | 'rejection' }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, data: { message: string; stack: string | undefined; type: 'exception' | 'rejection' }) => callback(data);
    ipcRenderer.on('electronError', listener);
    return () => ipcRenderer.removeListener('electronError', listener);
  },
};

contextBridge.exposeInMainWorld('Electron', bridge);

function normalizeShowContextMenuOptions(options?: ShowContextMenuOptions): ShowContextMenuOptions {
  if (!options || typeof options !== 'object') return {};
  const normalized: ShowContextMenuOptions = {};
  if (Number.isFinite(options.x)) normalized.x = Math.round(Number(options.x));
  if (Number.isFinite(options.y)) normalized.y = Math.round(Number(options.y));
  if (options.target && typeof options.target === 'object') normalized.target = normalizeTarget(options.target);
  if ('data' in options) normalized.data = options.data;
  return normalized;
}

function contextMenuTarget(event: MouseEvent): ContextMenuTarget | undefined {
  const path = event.composedPath();
  const element = contextMenuTargetElement(path);
  if (!element) return undefined;
  return normalizeTarget(readTarget(element));
}

function contextMenuTargetElement(path: EventTarget[]): Element | undefined {
  const elements = path.filter((item): item is Element => item instanceof Element);
  if (elements.length === 0) return undefined;

  const semanticTarget = elements.find((element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.id) return true;
    if (Object.keys(element.dataset).length > 0) return true;
    return Array.from(element.classList).some(isContextMenuClass);
  });

  return semanticTarget ?? elements[0];
}

function readTarget(element: Element): ContextMenuTarget {
  const html = element as HTMLElement;
  const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
  const media = element.closest('img[src], video[src], audio[src]') as HTMLImageElement | HTMLVideoElement | HTMLAudioElement | null;
  const form = element.closest('input, textarea, select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const className = typeof html.className === 'string' ? html.className : undefined;
  const innerText = typeof html.innerText === 'string' ? html.innerText : '';
  const text = (innerText || element.textContent || '').replace(/\s+/g, ' ').trim();

  return {
    id: html.id || undefined,
    tagName: element.tagName.toLowerCase(),
    className,
    classList: Array.from(html.classList),
    dataset: readDataset(html.dataset),
    text: text || undefined,
    href: anchor?.href,
    src: media?.src,
    value: form?.value,
  };
}

function isContextMenuClass(className: string): boolean {
  return /(^|[-_:])(context|menu)([-_:]|$)/i.test(className);
}

function normalizeTarget(raw: Partial<ContextMenuTarget>): ContextMenuTarget {
  const target: ContextMenuTarget = {};
  const stringKeys = ['id', 'tagName', 'className', 'text', 'href', 'src', 'value'] as const;

  for (const key of stringKeys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) target[key] = value.slice(0, 500);
  }

  if (Array.isArray(raw.classList)) {
    target.classList = raw.classList
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .slice(0, 32)
      .map((value) => value.slice(0, 120));
  }

  if (raw.dataset && typeof raw.dataset === 'object') {
    target.dataset = {};
    for (const [key, value] of Object.entries(raw.dataset).slice(0, 32)) {
      if (typeof value === 'string') target.dataset[key.slice(0, 120)] = value.slice(0, 500);
    }
  }

  return target;
}

function readDataset(dataset: DOMStringMap): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(dataset).slice(0, 32)) {
    if (typeof value === 'string') values[key.slice(0, 120)] = value.slice(0, 500);
  }
  return Object.keys(values).length > 0 ? values : undefined;
}
