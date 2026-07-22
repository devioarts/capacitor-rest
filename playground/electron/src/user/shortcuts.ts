// Global keyboard shortcuts — edit freely, never overwritten by cap-electron sync.
// Shortcuts are active even when the app has no focus.
//
// Three variants:
//   { accelerator: 'CmdOrCtrl+Shift+K', event: 'my-event' }        → renderer: window.Electron.onShortcut()
//   { accelerator: 'CmdOrCtrl+Shift+H', action: 'toggleWindow' }   → built-in main-process action
//   { accelerator: 'CmdOrCtrl+Shift+L', handler: () => { ... } }   → custom main-process code
//
// Available actions: quit | minimize | maximize | toggleMaximize | toggleFullscreen | toggleWindow | focus | reload | openDevTools

import type { GlobalShortcutDef } from '../system/static/electron-api/shortcuts-main';

export const shortcuts: GlobalShortcutDef[] = [];
