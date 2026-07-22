// Electron implementation of @capacitor/inappbrowser
import {
  BrowserWindow,
  WebContentsView,
  shell,
  session,
  type BrowserWindowConstructorOptions,
  type Session,
} from 'electron';
import { emitPluginEvent, registerPlugin, type AnyRecord, type EventHooks } from '../../shared/functions';

const WEB_SCHEMES = new Set(['http:', 'https:']);
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);
const TOOLBAR_HEIGHT = 44;

type ToolbarPosition = 0 | 1;
type ElectronInAppBrowserOptions = {
  window?: Record<string, unknown>;
  session?: {
    partition?: string;
    clearCache?: boolean;
    clearStorage?: boolean;
  };
  navigation?: {
    openExternalLinksInSystemBrowser?: boolean;
  };
};

type WebViewOptions = {
  showURL?: boolean;
  showToolbar?: boolean;
  clearCache?: boolean;
  clearSessionCache?: boolean;
  toolbarColor?: string;
  closeButtonText?: string;
  toolbarPosition?: ToolbarPosition;
  showNavigationButtons?: boolean;
  leftToRight?: boolean;
  customWebViewUserAgent?: string | null;
  electron?: ElectronInAppBrowserOptions;
};

type ActiveBrowser = {
  win: BrowserWindow;
  view: WebContentsView;
  toolbarHeight: number;
  toolbarPosition: ToolbarPosition;
  openExternalLinksInSystemBrowser: boolean;
};

type BrowserEventNames = {
  plugin: string;
  closed: string;
  loaded: string;
  navigation?: string;
};

let activeBrowser: ActiveBrowser | null = null;

export function parseWebUrl(rawUrl: unknown): string {
  const url = new URL(String(rawUrl ?? ''));
  if (!WEB_SCHEMES.has(url.protocol)) {
    throw new Error(`InAppBrowser only supports http/https URLs: ${url.href}`);
  }
  return url.href;
}

export function canOpenExternal(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol !== null && !BLOCKED_SCHEMES.has(protocol);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function intInRange(value: unknown, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringValue(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

export function sanitizeWindowOptions(raw: unknown): BrowserWindowConstructorOptions {
  if (!isPlainObject(raw)) return {};

  const out: BrowserWindowConstructorOptions = {};
  const numberKeys = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'x', 'y'] as const;
  const booleanKeys = [
    'center',
    'alwaysOnTop',
    'resizable',
    'minimizable',
    'maximizable',
    'fullscreenable',
    'closable',
    'movable',
    'show',
    'frame',
    'fullscreen',
    'autoHideMenuBar',
    'modal',
  ] as const;

  for (const key of numberKeys) {
    const value = intInRange(raw[key], key === 'x' || key === 'y' ? -100_000 : 1, 100_000);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  for (const key of booleanKeys) {
    const value = bool(raw[key]);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }

  const title = stringValue(raw['title']);
  if (title) out.title = title;

  const backgroundColor = stringValue(raw['backgroundColor'], 80);
  if (backgroundColor) out.backgroundColor = backgroundColor;

  const opacity = Number(raw['opacity']);
  if (Number.isFinite(opacity)) out.opacity = Math.min(1, Math.max(0.1, opacity));

  if (raw['titleBarStyle'] === 'default' || raw['titleBarStyle'] === 'hidden' || raw['titleBarStyle'] === 'hiddenInset') {
    out.titleBarStyle = raw['titleBarStyle'];
  }

  return out;
}

function optionsOf(opts: AnyRecord): WebViewOptions {
  return isPlainObject(opts['options']) ? opts['options'] as WebViewOptions : {};
}

function electronOptions(options: WebViewOptions): ElectronInAppBrowserOptions {
  return isPlainObject(options.electron) ? options.electron as ElectronInAppBrowserOptions : {};
}

function browserSession(options: WebViewOptions): Session {
  const electron = electronOptions(options);
  const partition = stringValue(electron.session?.partition, 120);
  return partition ? session.fromPartition(partition) : session.defaultSession;
}

async function prepareSession(ses: Session, options: WebViewOptions): Promise<void> {
  const electron = electronOptions(options);
  if (options.clearCache || electron.session?.clearCache) await ses.clearCache();
  if (options.clearSessionCache || electron.session?.clearStorage) {
    await ses.clearData({ dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'webSQL', 'cache'] });
  }
}

function toolbarHtml(options: WebViewOptions): string {
  const closeText = stringValue(options.closeButtonText, 40) ?? 'Close';
  const toolbarColor = normalizeCssColor(options.toolbarColor) ?? '#f6f7f9';
  const showUrl = options.showURL !== false;
  const showNav = options.showNavigationButtons === true;
  const leftToRight = options.leftToRight === true;
  const nav = showNav
    ? '<a id="back" href="cap-electron-iab://back">Back</a><a id="forward" href="cap-electron-iab://forward">Forward</a><a id="reload" href="cap-electron-iab://reload">Reload</a>'
    : '';
  const close = `<a id="close" href="cap-electron-iab://close">${escapeHtml(closeText)}</a>`;
  const url = showUrl ? '<span id="url"></span>' : '<span id="url" hidden></span>';
  const actions = leftToRight ? `${nav}${close}` : `${close}${nav}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#f6f7f9;color:#1f2933;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
.bar{box-sizing:border-box;height:${TOOLBAR_HEIGHT}px;display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #d9dee7;background:${toolbarColor}}
.bottom{position:absolute;left:0;right:0;bottom:0;border-top:1px solid #d9dee7;border-bottom:0}
a{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:1px solid #ccd3df;border-radius:5px;background:#fff;color:#111827;text-decoration:none;white-space:nowrap}
a:hover{background:#eef2f7}
#url{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#52606d;background:#fff;border:1px solid #d9dee7;border-radius:5px;padding:5px 8px}
</style></head><body><div class="bar ${options.toolbarPosition === 1 ? 'bottom' : ''}">${actions}${url}</div></body></html>`;
}

export function normalizeCssColor(value: unknown): string | undefined {
  const color = stringValue(value, 80);
  if (!color) return undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color;
  if (/^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  if (/^hsla?\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function placeView(active: ActiveBrowser): void {
  if (active.win.isDestroyed()) return;
  const [width, height] = active.win.getContentSize();
  const toolbar = active.toolbarHeight;
  active.view.setBounds({
    x: 0,
    y: active.toolbarPosition === 1 ? 0 : toolbar,
    width,
    height: Math.max(1, height - toolbar),
  });
}

function updateToolbar(active: ActiveBrowser): void {
  if (active.win.isDestroyed()) return;
  const data = {
    url: active.view.webContents.getURL(),
    canGoBack: active.view.webContents.canGoBack(),
    canGoForward: active.view.webContents.canGoForward(),
  };
  void active.win.webContents.executeJavaScript(`
    (() => {
      const data = ${JSON.stringify(data)};
      const url = document.getElementById('url');
      if (url) url.textContent = data.url || '';
      const back = document.getElementById('back');
      const forward = document.getElementById('forward');
      if (back) back.style.opacity = data.canGoBack ? '1' : '.45';
      if (forward) forward.style.opacity = data.canGoForward ? '1' : '.45';
    })();
  `).catch(() => undefined);
}

function handleToolbarAction(active: ActiveBrowser, url: string): boolean {
  let action: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'cap-electron-iab:') return false;
    action = parsed.hostname;
  } catch {
    return false;
  }

  if (action === 'close') active.win.close();
  else if (action === 'back' && active.view.webContents.canGoBack()) active.view.webContents.goBack();
  else if (action === 'forward' && active.view.webContents.canGoForward()) active.view.webContents.goForward();
  else if (action === 'reload') active.view.webContents.reload();
  return true;
}

export function extraHeaders(headers: unknown): string | undefined {
  if (!isPlainObject(headers)) return undefined;
  const lines = Object.entries(headers)
    .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
    .map(([key, value]) => `${key}: ${value}`);
  return lines.length ? lines.join('\n') : undefined;
}

export function closeElectronWebView(): void {
  if (activeBrowser && !activeBrowser.win.isDestroyed()) activeBrowser.win.close();
  activeBrowser = null;
}

export async function openElectronWebView(opts: AnyRecord, events: BrowserEventNames): Promise<void> {
    const url = parseWebUrl(opts['url']);
    const options = optionsOf(opts);
    const electron = electronOptions(options);
    const ses = browserSession(options);
    await prepareSession(ses, options);

    // Capacitor's InAppBrowser model has one active web view. Opening a new one
    // replaces the existing Electron window and emits the normal close event.
    closeElectronWebView();

    const toolbarHeight = options.showToolbar === false ? 0 : TOOLBAR_HEIGHT;
    const toolbarPosition: ToolbarPosition = options.toolbarPosition === 1 ? 1 : 0;
    const windowOptions = sanitizeWindowOptions(electron.window);
    if (windowOptions.modal && !windowOptions.parent) {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (parent) windowOptions.parent = parent;
    }

    const win = new BrowserWindow({
      width: 1000,
      height: 720,
      title: 'InAppBrowser',
      show: true,
      ...windowOptions,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: ses,
      },
    });
    const active: ActiveBrowser = {
      win,
      view,
      toolbarHeight,
      toolbarPosition,
      openExternalLinksInSystemBrowser: electron.navigation?.openExternalLinksInSystemBrowser !== false,
    };
    activeBrowser = active;

    win.contentView.addChildView(view);
    placeView(active);
    win.on('resize', () => placeView(active));
    win.once('closed', () => {
      if (activeBrowser === active) activeBrowser = null;
      emitPluginEvent(events.plugin, events.closed);
    });

    if (toolbarHeight > 0) {
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml(options))}`);
      win.webContents.once('did-finish-load', () => updateToolbar(active));
      win.webContents.on('will-navigate', (event, nextUrl) => {
        if (handleToolbarAction(active, nextUrl)) event.preventDefault();
      });
    } else {
      win.loadURL('about:blank');
    }

    view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      if (active.openExternalLinksInSystemBrowser) {
        if (canOpenExternal(nextUrl)) void shell.openExternal(nextUrl);
        return { action: 'deny' };
      }
      if (WEB_SCHEMES.has(protocolOf(nextUrl) ?? '')) void view.webContents.loadURL(nextUrl);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, nextUrl) => {
      const protocol = protocolOf(nextUrl);
      if (protocol && !WEB_SCHEMES.has(protocol)) {
        event.preventDefault();
        if (active.openExternalLinksInSystemBrowser && canOpenExternal(nextUrl)) void shell.openExternal(nextUrl);
      }
    });
    view.webContents.on('did-finish-load', () => {
      updateToolbar(active);
      emitPluginEvent(events.plugin, events.loaded);
      if (events.navigation) emitPluginEvent(events.plugin, events.navigation, { url: view.webContents.getURL() });
    });
    view.webContents.on('did-navigate-in-page', (_event, nextUrl) => {
      updateToolbar(active);
      if (events.navigation) emitPluginEvent(events.plugin, events.navigation, { url: nextUrl });
    });
    view.webContents.on('did-navigate', (_event, nextUrl) => {
      updateToolbar(active);
      if (events.navigation) emitPluginEvent(events.plugin, events.navigation, { url: nextUrl });
    });

    const userAgent = stringValue(options.customWebViewUserAgent, 500);
    if (userAgent) view.webContents.setUserAgent(userAgent);

    void view.webContents.loadURL(url, { extraHeaders: extraHeaders(opts['customHeaders']) })
      .catch((err) => console.warn('[InAppBrowser] load failed:', err));
}

class InAppBrowser {
  async openInExternalBrowser(opts: AnyRecord): Promise<void> {
    await shell.openExternal(parseWebUrl(opts['url']));
  }

  async openInSystemBrowser(opts: AnyRecord): Promise<void> {
    await shell.openExternal(parseWebUrl(opts['url']));
  }

  async openInWebView(opts: AnyRecord): Promise<void> {
    await openElectronWebView(opts, {
      plugin: 'InAppBrowser',
      closed: 'browserClosed',
      loaded: 'browserPageLoaded',
      navigation: 'browserPageNavigationCompleted',
    });
  }

  async close(): Promise<void> {
    closeElectronWebView();
  }
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

const events: EventHooks = {
  browserClosed: {},
  browserPageLoaded: {},
  browserPageNavigationCompleted: {},
};

registerPlugin(
  'InAppBrowser',
  new InAppBrowser() as unknown as AnyRecord,
  ['openInExternalBrowser', 'openInSystemBrowser', 'openInWebView', 'close'],
  events,
);
