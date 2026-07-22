// Renderer context menu — edit freely, never overwritten by cap-electron upgrade.
//
// Only used when ui.contextMenu.enabled is true in capacitor.config.ts.
// Return null to show no menu for the current right-click.

import type { MenuItemConstructorOptions } from 'electron';
import type { ContextMenuContext } from '../../system/static/electron-api/menu-main';

export function contextMenu(ctx: ContextMenuContext): MenuItemConstructorOptions[] | null {
  if (isSettingsTarget(ctx)) {
    return [
      { label: 'Open Settings', click: () => ctx.send('open-settings', ctx.target) },
      { role: 'copy' },
    ];
  }

  if (isRowTarget(ctx)) {
    return [
      { label: 'Open Row', click: () => ctx.send('open-row', ctx.target?.dataset) },
      { label: 'Archive Row', click: () => ctx.send('archive-row', ctx.target?.dataset) },
    ];
  }

  if (ctx.trigger === 'renderer') {
    return [
      { label: 'Renderer action', click: () => ctx.send('renderer-context-action', ctx.data) },
      { label: 'Show Window', click: () => ctx.showWindow() },
    ];
  }

  if (ctx.params.isEditable) {
    return [
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    ];
  }

  return [
    { role: 'copy' },
    { type: 'separator' },
    { label: 'Open Settings', click: () => ctx.send('open-settings') },
    ...(ctx.isDev
      ? [{
        label: 'Inspect Element',
        click: () => ctx.window.webContents.inspectElement(ctx.params.x ?? 0, ctx.params.y ?? 0),
      } satisfies MenuItemConstructorOptions]
      : []),
  ];
}

function isSettingsTarget(ctx: ContextMenuContext): boolean {
  return ctx.target?.id === 'settings-card'
    || ctx.target?.dataset?.menuKind === 'settings';
}

function isRowTarget(ctx: ContextMenuContext): boolean {
  return ctx.target?.classList?.includes('context-row') === true
    || typeof ctx.target?.dataset?.rowId === 'string';
}
