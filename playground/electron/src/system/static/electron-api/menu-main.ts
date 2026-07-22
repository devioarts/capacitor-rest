// Native app/context/Dock/tray menu setup plus renderer menu action bridge.
import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { trustedIpcHandle, trustedIpcOn, trustedIpcOnSync } from '../../shared/functions';
import type { AppMenuConfig, ContextMenuTarget, ContextMenuTrigger, ElectronConfig, MenuActionSource, ShowContextMenuOptions } from '../../shared/types';

export interface MenuContext {
  appName: string;
  isDev: boolean;
  getWin: () => BrowserWindow | null;
  showWindow: () => BrowserWindow | null;
  send: (action: string, data?: unknown) => void;
}

export interface ContextMenuContext extends MenuContext {
  window: BrowserWindow;
  trigger: ContextMenuTrigger;
  params: Partial<Electron.ContextMenuParams>;
  target?: ContextMenuTarget;
  data?: unknown;
}

export type ApplicationMenuFactory = (ctx: MenuContext) => MenuItemConstructorOptions[] | null | undefined;
export type ContextMenuFactory = (ctx: ContextMenuContext) => MenuItemConstructorOptions[] | null | undefined;
export type DockMenuFactory = (ctx: MenuContext) => MenuItemConstructorOptions[] | null | undefined;

type ContextMenuRuntime = {
  cfg: ElectronConfig;
  isDev: boolean;
  getWin: () => BrowserWindow | null;
  userMenu: ContextMenuFactory;
};

type LatestContextTarget = {
  x: number;
  y: number;
  at: number;
  target?: ContextMenuTarget;
};

let contextMenuRuntime: ContextMenuRuntime | null = null;
let contextMenuIpcRegistered = false;
let contextTargetIpcRegistered = false;
const latestContextTargets = new Map<number, LatestContextTarget>();

registerContextTargetIpc();

/**
 * Configure the native application menu (menu bar).
 *
 * - `cfg.ui.appMenu === undefined` — keeps Electron's default menu unchanged.
 * - `cfg.ui.appMenu.hide === true` — removes the menu entirely on Windows/Linux; on macOS keeps a
 *   minimal App menu (Quit only) because Cmd+Q must always work.
 * - `cfg.ui.appMenu.enabled === true` — uses `src/user/menu/app.ts` when it returns a
 *   template, otherwise falls back to the built-in edit/view preset.
 */
export function setupMenu(
  cfg: ElectronConfig,
  isDev: boolean,
  getWin: () => BrowserWindow | null,
  userMenu?: ApplicationMenuFactory,
): void {
  const menu = cfg.ui?.appMenu;

  if (menu === undefined) return;

  if (menu.hide === true) {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: app.name, submenu: [{ role: 'quit' }] },
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
    return;
  }

  if (menu.enabled !== true) return;

  const ctx = createMenuContext('app', isDev, getWin);
  const customTemplate = userMenu?.(ctx);
  const template = Array.isArray(customTemplate)
    ? customTemplate
    : buildPresetMenu(menu, isDev);

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function setupContextMenu(
  win: BrowserWindow,
  cfg: ElectronConfig,
  isDev: boolean,
  getWin: () => BrowserWindow | null,
  userMenu?: ContextMenuFactory,
): void {
  const contextMenu = cfg.ui?.contextMenu;
  if (contextMenu?.enabled !== true || !userMenu) return;

  contextMenuRuntime = { cfg, isDev, getWin, userMenu };
  registerContextMenuIpc();

  win.webContents.on('context-menu', (_event, params) => {
    showContextMenu({
      win,
      isDev,
      getWin,
      userMenu,
      trigger: 'right-click',
      params,
      target: matchingContextTarget(win.webContents.id),
    });
  });

  win.webContents.once('destroyed', () => {
    latestContextTargets.delete(win.webContents.id);
  });
}

export function setupDockMenu(
  cfg: ElectronConfig,
  isDev: boolean,
  getWin: () => BrowserWindow | null,
  userMenu?: DockMenuFactory,
): void {
  if (process.platform !== 'darwin' || cfg.ui?.dockMenu?.enabled !== true || !userMenu) return;

  const template = userMenu(createMenuContext('dock', isDev, getWin));
  if (!Array.isArray(template) || template.length === 0) return;
  app.dock?.setMenu(Menu.buildFromTemplate(template));
}

export function createMenuContext(source: MenuActionSource, isDev: boolean, getWin: () => BrowserWindow | null): MenuContext {
  const showWindow = (): BrowserWindow | null => {
    const win = getWin();
    if (!win) return null;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  };

  return {
    appName: app.name,
    isDev,
    getWin,
    showWindow,
    send: (action: string, data?: unknown) => {
      const win = showWindow();
      if (!win) return;
      win.webContents.send('menu:action', { source, action, data });
    },
  };
}

function buildPresetMenu(menu: AppMenuConfig, isDev: boolean): MenuItemConstructorOptions[] {
  const { editMenu = true, viewMenu } = menu;
  const showView = isDev || viewMenu === true;
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  if (editMenu) template.push({ role: 'editMenu' });
  if (showView) template.push({ role: 'viewMenu' });

  return template;
}

function registerContextMenuIpc(): void {
  if (contextMenuIpcRegistered) return;
  contextMenuIpcRegistered = true;

  trustedIpcHandle('menu:showContextMenu', (event, raw: unknown): boolean => {
    const runtime = contextMenuRuntime;
    if (!runtime || runtime.cfg.ui?.contextMenu?.enabled !== true) return false;

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;

    const options = normalizeShowContextMenuOptions(raw);
    return showContextMenu({
      win,
      isDev: runtime.isDev,
      getWin: runtime.getWin,
      userMenu: runtime.userMenu,
      trigger: options.target ? 'right-click' : 'renderer',
      params: {
        x: options.x,
        y: options.y,
      },
      target: options.target,
      data: options.data,
      popup: {
        x: options.x,
        y: options.y,
      },
    });
  });
}

function registerContextTargetIpc(): void {
  if (contextTargetIpcRegistered) return;
  contextTargetIpcRegistered = true;

  trustedIpcOn('menu:contextTarget', (event, raw: unknown) => {
    const payload = normalizeContextTargetPayload(raw);
    if (!payload) return;
    latestContextTargets.set(event.sender.id, payload);
  });

  trustedIpcOnSync('menu:contextTargetSync', (event, raw: unknown) => {
    const payload = normalizeContextTargetPayload(raw);
    if (!payload) return false;
    latestContextTargets.set(event.sender.id, payload);
    return true;
  });
}

function showContextMenu(options: {
  win: BrowserWindow;
  isDev: boolean;
  getWin: () => BrowserWindow | null;
  userMenu: ContextMenuFactory;
  trigger: ContextMenuTrigger;
  params: Partial<Electron.ContextMenuParams>;
  target?: ContextMenuTarget;
  data?: unknown;
  popup?: { x?: number; y?: number };
}): boolean {
  const template = options.userMenu({
    ...createMenuContext('context', options.isDev, options.getWin),
    window: options.win,
    trigger: options.trigger,
    params: options.params,
    target: options.target,
    data: options.data,
  });

  if (!Array.isArray(template) || template.length === 0) return false;

  Menu.buildFromTemplate(template).popup({
    window: options.win,
    ...(typeof options.popup?.x === 'number' ? { x: options.popup.x } : {}),
    ...(typeof options.popup?.y === 'number' ? { y: options.popup.y } : {}),
  });

  return true;
}

function matchingContextTarget(webContentsId: number): ContextMenuTarget | undefined {
  const latest = latestContextTargets.get(webContentsId);
  if (!latest) return undefined;
  if (Date.now() - latest.at > 1000) return undefined;
  return latest.target;
}

function normalizeContextTargetPayload(raw: unknown): LatestContextTarget | null {
  if (!isRecord(raw)) return null;
  const x = finiteNumber(raw['x']);
  const y = finiteNumber(raw['y']);
  if (x === undefined || y === undefined) return null;

  return {
    x,
    y,
    at: Date.now(),
    target: normalizeContextMenuTarget(raw['target']),
  };
}

function normalizeShowContextMenuOptions(raw: unknown): ShowContextMenuOptions {
  if (!isRecord(raw)) return {};
  return {
    x: finiteNumber(raw['x']),
    y: finiteNumber(raw['y']),
    target: normalizeContextMenuTarget(raw['target']),
    ...('data' in raw ? { data: raw['data'] } : {}),
  };
}

function normalizeContextMenuTarget(raw: unknown): ContextMenuTarget | undefined {
  if (!isRecord(raw)) return undefined;

  const target: ContextMenuTarget = {};
  const stringKeys = ['id', 'tagName', 'className', 'text', 'href', 'src', 'value'] as const;
  for (const key of stringKeys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) target[key] = value.slice(0, 500);
  }

  if (Array.isArray(raw['classList'])) {
    target.classList = raw['classList']
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .slice(0, 32)
      .map((value) => value.slice(0, 120));
  }

  if (isRecord(raw['dataset'])) {
    target.dataset = {};
    for (const [key, value] of Object.entries(raw['dataset']).slice(0, 32)) {
      if (typeof value === 'string') target.dataset[key.slice(0, 120)] = value.slice(0, 500);
    }
  }

  return Object.keys(target).length > 0 ? target : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
