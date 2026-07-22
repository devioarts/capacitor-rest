// window.Electron.nativeTheme bridge for reading and controlling Electron theme state.
import { BrowserWindow, nativeTheme } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';

function snapshot(): { shouldUseDarkColors: boolean; themeSource: typeof nativeTheme.themeSource; shouldUseHighContrastColors: boolean; shouldUseInvertedColorScheme: boolean } {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
    shouldUseHighContrastColors: nativeTheme.shouldUseHighContrastColors,
    shouldUseInvertedColorScheme: nativeTheme.shouldUseInvertedColorScheme,
  };
}

nativeTheme.on('updated', () => {
  const data = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('nativeTheme:updated', data);
  }
});

trustedIpcHandle('nativeTheme:get', () => snapshot());
trustedIpcHandle('nativeTheme:setThemeSource', (_e, source: typeof nativeTheme.themeSource) => {
  if (!['system', 'light', 'dark'].includes(source)) throw new Error(`Invalid theme source: ${source}`);
  nativeTheme.themeSource = source;
  return snapshot();
});
