// window.Electron.downloads bridge that coordinates renderer requests with Electron DownloadItem events.
import { BrowserWindow, type DownloadItem, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { trustedIpcHandle, trustedIpcOn } from '../../shared/functions';

type DownloadState = {
  id: string;
  url: string;
  filename: string;
  savePath?: string;
  state: 'requested' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number;
  totalBytes: number;
};

const pending = new Map<string, DownloadState[]>();
const active = new Map<string, { item: DownloadItem; state: DownloadState }>();

export function downloadDoneEventType(itemState: string): DownloadState['state'] | 'done' {
  if (itemState === 'completed' || itemState === 'cancelled' || itemState === 'interrupted') return itemState;
  return 'done';
}

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) throw new Error('No BrowserWindow for download request');
  return win;
}

function emit(win: BrowserWindow, type: string, state: DownloadState): void {
  if (!win.isDestroyed()) win.webContents.send('downloads:event', { type, data: { ...state } });
}

function enqueuePending(state: DownloadState): void {
  const queue = pending.get(state.url);
  if (queue) queue.push(state);
  else pending.set(state.url, [state]);
}

function dequeuePending(url: string): DownloadState | undefined {
  const queue = pending.get(url);
  const state = queue?.shift();
  if (queue && queue.length === 0) pending.delete(url);
  return state;
}

function attachDownload(win: BrowserWindow, item: DownloadItem, initial: DownloadState): void {
  const state = initial;
  state.filename = item.getFilename();
  state.totalBytes = item.getTotalBytes();
  if (state.savePath) item.setSavePath(state.savePath);
  active.set(state.id, { item, state });
  emit(win, 'started', state);

  item.on('updated', (_event, itemState) => {
    state.state = itemState === 'interrupted' ? 'interrupted' : 'progressing';
    state.receivedBytes = item.getReceivedBytes();
    state.totalBytes = item.getTotalBytes();
    state.savePath = item.getSavePath();
    emit(win, 'updated', state);
  });

  item.once('done', (_event, itemState) => {
    state.state = itemState as DownloadState['state'];
    state.receivedBytes = item.getReceivedBytes();
    state.totalBytes = item.getTotalBytes();
    state.savePath = item.getSavePath();
    active.delete(state.id);
    emit(win, downloadDoneEventType(itemState), state);
  });
}

trustedIpcHandle('downloads:start', (e, opts: { url: string; savePath?: string }) => {
  const win = senderWindow(e);
  const parsed = new URL(String(opts?.url ?? ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('downloads.start only supports http/https URLs');
  const url = parsed.href;

  const state: DownloadState = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url,
    filename: path.basename(new URL(url).pathname) || 'download',
    savePath: opts?.savePath,
    state: 'requested',
    receivedBytes: 0,
    totalBytes: 0,
  };

  enqueuePending(state);
  win.webContents.downloadURL(url);
  return { ...state };
});

trustedIpcHandle('downloads:pause', (_e, id: string) => { active.get(id)?.item.pause(); });
trustedIpcHandle('downloads:resume', (_e, id: string) => { active.get(id)?.item.resume(); });
trustedIpcHandle('downloads:cancel', (_e, id: string) => { active.get(id)?.item.cancel(); });
trustedIpcHandle('downloads:getActive', () => [...active.values()].map(({ state }) => ({ ...state })));

// Attach once to every new window lazily. The listener lives on the session
// used by that window so partitioned sessions can still route their downloads.
const sessions = new WeakSet<Electron.Session>();
function ensureSession(win: BrowserWindow): void {
  const ses = win.webContents.session;
  if (sessions.has(ses)) return;
  sessions.add(ses);
  ses.on('will-download', (event, item, webContents) => {
    const owner = BrowserWindow.fromWebContents(webContents);
    if (!owner) return;
    const next = dequeuePending(item.getURL());
    if (!next) return;
    attachDownload(owner, item, next);
  });
}

trustedIpcOn('downloads:ensureSession', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) ensureSession(win);
});
