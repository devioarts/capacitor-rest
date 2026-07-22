/**
 * Electron preload — runs in a sandboxed Node.js context before the renderer page.
 *
 * Import order matters:
 *
 *  1. capacitor-preload  — exposes window._CapElectron (raw IPC bridge + PluginHeaders).
 *                          Required by electron-init.js in the renderer.
 *
 *  2. plugins-preload    — CRITICAL PATH. Exposes window.CapacitorCustomPlatform so that
 *                          third-party plugins using the `electron:` factory in
 *                          registerPlugin() always resolve, even if electron-init.js fails.
 *
 *  3. electron-preload   — exposes window.Electron (desktop/system APIs).
 */
import './src/system/static/capacitor-api/capacitor-preload';
import './src/system/static/plugins-api/plugins-preload';
import './src/system/static/electron-api/electron-preload';
