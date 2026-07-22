// macOS Dock menu — edit freely, never overwritten by cap-electron upgrade.
//
// Only used on macOS when ui.dockMenu.enabled is true in capacitor.config.ts.
// Return null to show no custom Dock menu.

import type { MenuItemConstructorOptions } from 'electron';
import type { MenuContext } from '../../system/static/electron-api/menu-main';

export function dockMenu(ctx: MenuContext): MenuItemConstructorOptions[] | null {
  return [
    { label: 'Show Window', click: () => ctx.showWindow() },
    { label: 'Open Settings', click: () => ctx.send('open-settings') },
  ];
}
