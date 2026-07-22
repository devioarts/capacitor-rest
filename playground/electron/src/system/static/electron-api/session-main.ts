// window.Electron.session bridge scoped to the sender window's Electron session.
import { BrowserWindow, session, type IpcMainInvokeEvent } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';

function ses(e: IpcMainInvokeEvent): Electron.Session {
  return BrowserWindow.fromWebContents(e.sender)?.webContents.session ?? session.defaultSession;
}

trustedIpcHandle('session:clearCache', (e) => ses(e).clearCache());
trustedIpcHandle('session:clearStorageData', (e, opts: Electron.ClearStorageDataOptions) => ses(e).clearStorageData(opts ?? {}));
trustedIpcHandle('session:getUserAgent', (e) => ses(e).getUserAgent());
trustedIpcHandle('session:setUserAgent', (e, userAgent: string) => { ses(e).setUserAgent(userAgent); });
trustedIpcHandle('session:resolveProxy', (e, url: string) => ses(e).resolveProxy(url));
trustedIpcHandle('session:setProxy', (e, config: Electron.ProxyConfig) => ses(e).setProxy(config ?? {}));
trustedIpcHandle('session:closeAllConnections', (e) => ses(e).closeAllConnections());

trustedIpcHandle('session:getCookies', (e, filter: Electron.CookiesGetFilter) => ses(e).cookies.get(filter ?? {}));
trustedIpcHandle('session:setCookie', (e, cookie: Electron.CookiesSetDetails) => ses(e).cookies.set(cookie));
trustedIpcHandle('session:removeCookie', (e, opts: { url: string; name: string }) => ses(e).cookies.remove(opts.url, opts.name));
