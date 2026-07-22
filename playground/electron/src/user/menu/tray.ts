// Tray menu — edit freely, never overwritten by cap-electron upgrade.
//
// Only used when ui.trayMenu.enabled is true in capacitor.config.ts.
// Return a normal Electron Menu.buildFromTemplate() template.

import { app, type MenuItemConstructorOptions } from 'electron';
import type { TrayMenuContext } from '../../system/static/electron-api/tray-main';

export function trayMenu(ctx: TrayMenuContext): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Open',
      click: () => ctx.showWindow(),
    },
    {
      label: 'Settings',
      click: () => ctx.send('open-settings'),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}
