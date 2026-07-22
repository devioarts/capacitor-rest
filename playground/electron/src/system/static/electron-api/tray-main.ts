// Tray icon lifecycle and user-owned tray menu integration.
import { app, Tray, Menu, BrowserWindow, nativeImage, type MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ElectronConfig } from '../../shared/types';
import { createMenuContext, type MenuContext } from './menu-main';

type GetWin = () => BrowserWindow | null;

export interface TrayMenuContext extends MenuContext {
  tray: Tray;
}

export type TrayMenuFactory = (ctx: TrayMenuContext) => MenuItemConstructorOptions[] | null | undefined;

let isQuitting = false;
let tray: Tray | null = null;

/**
 * Set up the system tray icon and context menu.
 *
 * Call inside `app.whenReady()`. Returns a `hookWindow` function when
 * `minimizeToTray` is enabled — pass it the newly created `BrowserWindow`
 * inside `createWindow()` to wire up the close-to-tray behaviour.
 *
 * @param cfg        Electron config (reads `cfg.ui.trayMenu.*` and `cfg.browserWindow.icon` as fallback).
 * @param isDev      `true` when the app is not packaged.
 * @param getWin     Getter that returns the current main BrowserWindow (or null).
 * @param userMenu   Menu template factory from `src/user/menu/tray.ts`.
 * @returns          A `hookWindow(win)` function, or `null` if minimizeToTray is off.
 */
export function setupTray(
  cfg: ElectronConfig,
  isDev: boolean,
  getWin: GetWin,
  userMenu?: TrayMenuFactory,
): ((win: BrowserWindow) => void) | null {
  const trayConfig = cfg.ui?.trayMenu;
  if (!trayConfig?.enabled) return null;

  const iconSrc = trayConfig.icon ?? cfg.browserWindow?.icon;
  let image = nativeImage.createEmpty();
  if (iconSrc) {
    const abs = path.join(__dirname, '..', 'assets', iconSrc as string);
    if (fs.existsSync(abs)) image = nativeImage.createFromPath(abs);
  }

  // Keep a module-level reference so Electron does not garbage collect the tray.
  tray = new Tray(image);
  if (trayConfig.tooltip) tray.setToolTip(trayConfig.tooltip);

  const template = userMenu?.({ ...createMenuContext('tray', isDev, getWin), tray });
  if (Array.isArray(template) && template.length > 0) {
    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  tray.on('click', () => {
    const win = getWin();
    if (!win) return;
    if (win.isVisible() && !win.isMinimized()) win.hide();
    else { win.show(); win.focus(); }
  });

  if (!trayConfig.minimizeToTray) return null;

  app.on('before-quit', () => { isQuitting = true; });

  return (win: BrowserWindow) => {
    win.on('close', e => {
      if (isQuitting) return;
      e.preventDefault();
      win.hide();
    });
  };
}
