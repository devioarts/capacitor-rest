// Managed secondary BrowserWindow bridge for trusted app routes and untrusted external URLs.
import { BrowserWindow, shell, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { trustedIpcHandle } from '../../shared/functions';

const managed = new Map<number, BrowserWindow>();
const MAX_APP_PATH_LENGTH = 2048;

export type ManagedWindowAppTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; filePath: string; options?: Electron.LoadFileOptions };
type ManagedWindowContentTarget = ManagedWindowAppTarget | { kind: 'external'; url: string };

type ManagedWindowOptions = Pick<BrowserWindowConstructorOptions,
  | 'width'
  | 'height'
  | 'x'
  | 'y'
  | 'minWidth'
  | 'minHeight'
  | 'title'
  | 'modal'
  | 'alwaysOnTop'
  | 'resizable'
  | 'minimizable'
  | 'maximizable'
  | 'fullscreenable'
  | 'backgroundColor'
  | 'show'
> & { url?: string; appPath?: string };

let appResolver: ((appPath: string) => ManagedWindowAppTarget) | null = null;

export function setManagedWindowAppResolver(resolver: (appPath: string) => ManagedWindowAppTarget): void {
  appResolver = resolver;
}

function currentWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

function serialize(win: BrowserWindow): Record<string, unknown> {
  return {
    id: win.id,
    title: win.getTitle(),
    bounds: win.getBounds(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    isMinimized: win.isMinimized(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
    isDestroyed: win.isDestroyed(),
  };
}

function getManaged(id: number): BrowserWindow {
  const win = managed.get(id);
  if (!win || win.isDestroyed()) throw new Error(`Managed window not found: ${id}`);
  return win;
}

export function webUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
  return url.href;
}

export function appPath(rawAppPath: unknown): string | undefined {
  if (rawAppPath === undefined) return undefined;
  if (typeof rawAppPath !== 'string') throw new Error('appPath must be a string');
  if (rawAppPath.length > MAX_APP_PATH_LENGTH) throw new Error('appPath is too long');
  if (/^[a-z][a-z0-9+\-.]*:/i.test(rawAppPath) || rawAppPath.startsWith('//')) {
    throw new Error('appPath must be app-relative, not an absolute URL');
  }
  if (rawAppPath !== '' && !rawAppPath.startsWith('/') && !rawAppPath.startsWith('?') && !rawAppPath.startsWith('#')) {
    throw new Error('appPath must start with "/", "?", or "#"');
  }
  return rawAppPath;
}

function windowOptions(raw: ManagedWindowOptions | undefined): ManagedWindowOptions {
  const opts = raw ?? {};
  const url = opts.url;
  const internalPath = appPath(opts.appPath);
  if (url && internalPath !== undefined) throw new Error('Use either url or appPath, not both');

  const allowed: ManagedWindowOptions = {
    width: opts.width,
    height: opts.height,
    x: opts.x,
    y: opts.y,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    title: opts.title,
    modal: opts.modal,
    alwaysOnTop: opts.alwaysOnTop,
    resizable: opts.resizable,
    minimizable: opts.minimizable,
    maximizable: opts.maximizable,
    fullscreenable: opts.fullscreenable,
    backgroundColor: opts.backgroundColor,
    show: opts.show,
    url,
    appPath: internalPath,
  };

  for (const key of Object.keys(allowed) as Array<keyof ManagedWindowOptions>) {
    if (allowed[key] === undefined) delete allowed[key];
  }

  return allowed;
}

function resolveManagedContent(opts: ManagedWindowOptions): ManagedWindowContentTarget | null {
  if (opts.appPath !== undefined) {
    if (!appResolver) throw new Error('Managed app windows are not ready yet');
    return appResolver(opts.appPath);
  }

  return opts.url ? { kind: 'external', url: webUrl(opts.url) } : null;
}

function loadManagedContent(win: BrowserWindow, target: ManagedWindowContentTarget | null): void {
  if (!target) return;
  if (target.kind === 'file') {
    void win.loadFile(target.filePath, target.options);
    return;
  }

  void win.loadURL(target.url);
}

trustedIpcHandle('windows:create', (e, rawOpts: ManagedWindowOptions | undefined) => {
  const opts = windowOptions(rawOpts);
  const contentTarget = resolveManagedContent(opts);
  const parent = currentWindow(e) ?? undefined;
  // Internal appPath windows are trusted app UI and get the preload bridge.
  // External url windows are untrusted web content and must not receive it.
  const usePreload = !opts.url;
  const { url: _url, appPath: _appPath, ...browserOptions } = opts;
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    parent,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(usePreload ? { preload: path.join(__dirname, 'preload.cjs') } : {}),
    },
    ...browserOptions,
  });
  managed.set(win.id, win);
  win.once('closed', () => managed.delete(win.id));

  loadManagedContent(win, contentTarget);

  return serialize(win);
});

trustedIpcHandle('windows:list', () => BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).map(serialize));
trustedIpcHandle('windows:focus', (_e, id: number) => { getManaged(id).focus(); });
trustedIpcHandle('windows:close', (_e, id: number) => { getManaged(id).close(); });
trustedIpcHandle('windows:show', (_e, id: number) => { getManaged(id).show(); });
trustedIpcHandle('windows:hide', (_e, id: number) => { getManaged(id).hide(); });
trustedIpcHandle('windows:setBounds', (_e, opts: { id: number; bounds: Electron.Rectangle }) => { getManaged(opts.id).setBounds(opts.bounds); });
trustedIpcHandle('windows:openExternal', async (_e, url: string) => { await shell.openExternal(webUrl(url)); });
