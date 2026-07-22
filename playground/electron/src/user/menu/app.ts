// Application menu — edit freely, never overwritten by cap-electron upgrade.
//
// Return a full Electron Menu.buildFromTemplate() template to replace the built-in
// preset. Return null to use the simple ui.appMenu preset from capacitor.config.ts.

import type { MenuItemConstructorOptions } from 'electron';
import type { MenuContext } from '../../system/static/electron-api/menu-main';

export function appMenu(ctx: MenuContext): MenuItemConstructorOptions[] | null {
  return [
    ...(process.platform === 'darwin'
      ? [{
        label: ctx.appName,
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
      } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open', accelerator: 'CmdOrCtrl+O', click: () => ctx.showWindow() },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => ctx.send('open-settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    ...(ctx.isDev ? [{ role: 'viewMenu' as const }] : []),
  ];
}
