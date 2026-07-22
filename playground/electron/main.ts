// Main-process entry point for the generated Electron app template.
import './src/system/shared/bootstrap-identity';
import './src/system/static/electron-api/process-guardian';
import { app, BrowserWindow, nativeImage, type BrowserWindowConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, setupUpdater, setupDeepLinking, flushDeepLink, setupCSP, setupMenu, setupContextMenu, setupDockMenu, setupSplash, loadWindowState, trackWindowState, setupShortcuts, setupTray, startLocalServer, setIpcSenderCheck, setMainWindow, setManagedWindowAppResolver, appProtocolUrl, isAppProtocolUrl, registerAppProtocolPrivileges, resolveAppProtocolConfig, setupAppProtocol, type ManagedWindowAppTarget, type ResolvedAppProtocolConfig } from './src';
import { shortcuts } from './src/user/shortcuts';
import { appMenu } from './src/user/menu/app';
import { contextMenu } from './src/user/menu/context';
import { dockMenu } from './src/user/menu/dock';
import { trayMenu } from './src/user/menu/tray';
import { onReady } from './src/user/main-user';

const isDev = !app.isPackaged;

const { appCfg, cfg } = loadConfig();
const appConfig = cfg.app ?? {};
const devConfig = cfg.dev ?? {};
const browserWindowConfig = cfg.browserWindow ?? {};
const appProtocol = !isDev && appConfig.serveMode === 'protocol'
  ? resolveAppProtocolConfig(appConfig.protocol)
  : null;

if (appProtocol) registerAppProtocolPrivileges(appProtocol);

// Set app identity before app.ready so Windows Action Center and macOS dock
// show the correct name. On Windows, AUMID must also be set before ready.
if (appCfg.appName) app.setName(appCfg.appName);
if (process.platform === 'win32' && appCfg.appId) app.setAppUserModelId(appCfg.appId);

const iconImage = (() => {
  if (typeof browserWindowConfig.icon !== 'string') return undefined;
  const p = path.join(__dirname, '..', 'assets', browserWindowConfig.icon);
  if (!fs.existsSync(p)) return undefined;
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? undefined : img;
})();

function resolveUrlAppPath(baseHref: string, appPath: string): ManagedWindowAppTarget {
  const base = new URL(baseHref);
  const root = base.origin === 'null' ? `${base.protocol}//${base.host}` : base.origin;
  if (appPath.startsWith('/')) return { kind: 'url', url: new URL(appPath, root).href };
  if (appPath.startsWith('?')) base.search = appPath;
  else if (appPath.startsWith('#')) base.hash = appPath.slice(1);
  return { kind: 'url', url: base.href };
}

function resolveFileAppPath(indexHtml: string, appPath: string): ManagedWindowAppTarget {
  const options: Electron.LoadFileOptions = {};
  if (appPath.startsWith('?')) options.search = appPath;
  else if (appPath.startsWith('#')) options.hash = appPath.slice(1);
  else if (appPath.startsWith('/')) options.hash = appPath;
  return Object.keys(options).length
    ? { kind: 'file', filePath: indexHtml, options }
    : { kind: 'file', filePath: indexHtml };
}

// Single instance lock — default on, opt-out with singleInstance: false
if (appConfig.singleInstance !== false && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  setup();
}

function setup(): void {
  let win: BrowserWindow | null = null;
  const getWin = () => win;

  if (appConfig.deepLinkingScheme) {
    setupDeepLinking(appConfig.deepLinkingScheme, getWin);
  }

  /**
   * Create the main BrowserWindow and load the web app.
   *
   * @param hideSplash     Callback that closes the splash screen once the renderer
   *                       finishes or fails loading. Pass `null` when reopening on macOS.
   * @param hookTrayWindow Callback from `setupTray` that wires up close-to-tray
   *                       behaviour. `null` when `minimizeToTray` is disabled.
   */
  function createWindow(hideSplash?: ((onClosed?: () => void) => void) | null, hookTrayWindow?: ((win: BrowserWindow) => void) | null): void {
    const windowState = loadWindowState(cfg);
    const configuredWebPreferences = browserWindowConfig.webPreferences ?? {};

    const windowOptions: BrowserWindowConstructorOptions = {
      ...browserWindowConfig,
      width:          windowState.width,
      height:         windowState.height,
      x:              windowState.x,
      y:              windowState.y,
      minWidth:       browserWindowConfig.minWidth as number | undefined,
      minHeight:      browserWindowConfig.minHeight as number | undefined,
      fullscreen:     (browserWindowConfig.fullscreen as boolean | undefined) ?? false,
      fullscreenable: (browserWindowConfig.fullscreenable as boolean | undefined) !== false,
      resizable:      (browserWindowConfig.resizable as boolean | undefined) !== false,
      center:         windowState.x == null && browserWindowConfig.center !== false,
      alwaysOnTop:    (browserWindowConfig.alwaysOnTop as boolean | undefined) ?? false,
      kiosk:          (browserWindowConfig.kiosk as boolean | undefined) ?? false,
      frame:            browserWindowConfig.frame !== false,
      titleBarStyle:    browserWindowConfig.titleBarStyle as BrowserWindowConstructorOptions['titleBarStyle'],
      autoHideMenuBar:  (browserWindowConfig.autoHideMenuBar as boolean | undefined) ?? false,
      backgroundColor:  appCfg.backgroundColor,
      title:            appCfg.appName,
      icon:             iconImage,
      show:             !hideSplash,
      webPreferences: {
        ...configuredWebPreferences,
        contextIsolation: true,
        nodeIntegration:  false,
        preload:          path.join(__dirname, 'preload.cjs'),
      },
    };

    win = new BrowserWindow(windowOptions);
    setMainWindow(win);
    restoreConfiguredImmersiveMode(win, {
      kiosk: windowOptions.kiosk === true,
      fullscreen: windowOptions.fullscreen === true,
    });

    if (isDev) {
      const devUrl = devConfig.url ?? 'http://localhost:5173';
      const devOrigin = (() => { try { return new URL(devUrl).origin; } catch { return devUrl; } })();
      setIpcSenderCheck(url => { try { return new URL(url).origin === devOrigin; } catch { return false; } });
      setManagedWindowAppResolver(appPath => resolveUrlAppPath(devUrl, appPath));
      win.loadURL(devUrl);
      if (devConfig.openDevTools !== false) win.webContents.openDevTools();
      watchPreloadSignal(win);
    } else if (appProtocol) {
      const indexUrl = appProtocolUrl(appProtocol);
      setIpcSenderCheck(url => isAppProtocolUrl(url, appProtocol));
      setManagedWindowAppResolver(appPath => resolveUrlAppPath(indexUrl, appPath));
      win.loadURL(indexUrl);
      if (devConfig.openDevTools === true) win.webContents.openDevTools();
    } else if (appConfig.serveMode === 'server') {
      const w = win;
      startLocalServer(path.join(process.resourcesPath, 'app')).then((port) => {
        const serverOrigin = `http://127.0.0.1:${port}`;
        setIpcSenderCheck(url => { try { return new URL(url).origin === serverOrigin; } catch { return false; } });
        setManagedWindowAppResolver(appPath => resolveUrlAppPath(`${serverOrigin}/index.html`, appPath));
        if (!w.isDestroyed()) w.loadURL(`${serverOrigin}/index.html`);
      });
      if (devConfig.openDevTools === true) win.webContents.openDevTools();
    } else {
      const indexHtml = path.join(process.resourcesPath, 'app', 'index.html');
      setIpcSenderCheck(url => url.startsWith('file:'));
      setManagedWindowAppResolver(appPath => resolveFileAppPath(indexHtml, appPath));
      win.loadFile(indexHtml);
      if (devConfig.openDevTools === true) win.webContents.openDevTools();
    }

    applySecurityHardening(win, isDev, appProtocol);
    setupContextMenu(win, cfg, isDev, getWin, contextMenu);

    if (windowState.isMaximized) win.maximize();
    if (appConfig.persistWindowState) trackWindowState(win);

    if (hideSplash) {
      const hide = hideSplash;
      const w = win;
      const onLoad = () => {
        w.webContents.off('did-finish-load', onLoad);
        w.webContents.off('did-fail-load', onLoad);
        hide(() => { if (!w.isDestroyed()) w.show(); });
      };
      w.webContents.once('did-finish-load', onLoad);
      w.webContents.once('did-fail-load', onLoad);
    }
    if (hookTrayWindow) hookTrayWindow(win);

    win.on('closed', () => { setMainWindow(null); win = null; });
  }

  app.whenReady().then(() => {
    setupCSP(cfg, isDev);
    if (appProtocol) setupAppProtocol(path.join(process.resourcesPath, 'app'), appProtocol);
    setupMenu(cfg, isDev, getWin, appMenu);
    if (iconImage && process.platform === 'darwin') app.dock?.setIcon(iconImage);
    setupDockMenu(cfg, isDev, getWin, dockMenu);
    if (cfg.ui?.dockMenu?.hideIcon && process.platform === 'darwin') app.dock?.hide();
    setupShortcuts(shortcuts, getWin);
    const hookTrayWindow = setupTray(cfg, isDev, getWin, trayMenu);
    const hideSplash = setupSplash(cfg);
    createWindow(hideSplash, hookTrayWindow);
    onReady(getWin);
    if (appConfig.deepLinkingScheme) flushDeepLink(appConfig.deepLinkingScheme, getWin);
    setupUpdater(cfg);

    // macOS: reopen window when clicking dock icon
    app.on('activate', () => {
      if (win === null) createWindow(null, hookTrayWindow);
      else { win.show(); win.focus(); }
    });

    // Bring window to front when second instance is launched
    // (skipped when deep linking is active — deep-link-main.ts handles focus there)
    if (!appConfig.deepLinkingScheme) {
      app.on('second-instance', () => {
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/**
 * Apply security hardening to a BrowserWindow:
 *  - Block unexpected navigations (allow only same-origin or same file://)
 *  - Deny window.open / target=_blank (use shell.openExternal explicitly if needed)
 *  - Deny all permission requests by default
 */
function applySecurityHardening(win: BrowserWindow, dev: boolean, protocolConfig: ResolvedAppProtocolConfig | null): void {
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    let allow = false;
    try {
      const newU = new URL(url);
      if (current) {
        const curU = new URL(current);
        allow = (curU.protocol === 'file:' && newU.protocol === 'file:')
             || (curU.origin !== 'null' && curU.origin === newU.origin)
             || (!!protocolConfig && isAppProtocolUrl(current, protocolConfig) && isAppProtocolUrl(url, protocolConfig));
      }
    } catch { /* ignore invalid URLs */ }
    if (!allow) {
      event.preventDefault();
      if (dev) console.warn('[cap-electron] Blocked navigation to:', url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (dev) console.warn('[cap-electron] Blocked window.open for:', url);
    return { action: 'deny' };
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (dev) console.warn('[cap-electron] Blocked permission request:', permission);
    callback(false);
  });
}

function restoreConfiguredImmersiveMode(win: BrowserWindow, mode: { kiosk: boolean; fullscreen: boolean }): void {
  if (!mode.kiosk && !mode.fullscreen) return;

  const restore = () => {
    setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      if (mode.kiosk && !win.isKiosk()) {
        win.setKiosk(true);
      } else if (mode.fullscreen && !win.isFullScreen()) {
        win.setFullScreen(true);
      }
    }, 0);
  };

  win.on('restore', restore);
  win.on('show', restore);
  win.on('focus', restore);
}

/**
 * Watch the `.dev-reload` signal file written by `cap-electron open` whenever
 * `preload.cjs` is rebuilt, then reload the renderer so the fresh preload
 * script takes effect without restarting the whole Electron process.
 *
 * Only active in development (`isDev === true`).
 */
function watchPreloadSignal(win: BrowserWindow): void {
  const signalFile = path.join(__dirname, '.dev-reload');
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(signalFile, () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        if (!win.isDestroyed()) win.webContents.reload();
      }, 100);
    });
    win.on('closed', () => { watcher?.close(); });
  } catch {
    // Signal file absent means we're not running under cap-electron open — fine.
  }
}
