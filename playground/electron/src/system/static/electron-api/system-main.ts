// Core window/app controls exposed as top-level window.Electron methods.
import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';

function win(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

trustedIpcHandle('system:quit',           ()                  => { app.quit(); });
trustedIpcHandle('system:minimize',       (e)                 => {
  const w = win(e);
  if (w?.isFullScreen()) {
    w.once('leave-full-screen', () => w.minimize());
    w.setFullScreen(false);
  } else {
    w?.minimize();
  }
});
trustedIpcHandle('system:maximize',       (e)                 => { win(e)?.maximize(); });
trustedIpcHandle('system:unmaximize',     (e)                 => { win(e)?.unmaximize(); });
trustedIpcHandle('system:toggleMaximize', (e)                 => { const w = win(e); w?.isMaximized() ? w.unmaximize() : w?.maximize(); });
trustedIpcHandle('system:isMaximized',    (e)                 => win(e)?.isMaximized() ?? false);
trustedIpcHandle('system:setFullscreen',  (e, flag: boolean)  => { win(e)?.setFullScreen(flag); });
trustedIpcHandle('system:isFullscreen',   (e)                 => win(e)?.isFullScreen() ?? false);
trustedIpcHandle('system:focus',          (e)                 => { win(e)?.focus(); });
trustedIpcHandle('system:reload',         (e)                 => { win(e)?.reload(); });
trustedIpcHandle('system:openDevTools',   (e)                 => { win(e)?.webContents.openDevTools(); });
trustedIpcHandle('system:closeDevTools',  (e)                 => { win(e)?.webContents.closeDevTools(); });
trustedIpcHandle('system:getAppVersion',  ()                  => app.getVersion());
trustedIpcHandle('system:setBadgeCount',  (_, count: number)  => app.setBadgeCount(count));
trustedIpcHandle('system:getBadgeCount',  ()                  => app.getBadgeCount());
