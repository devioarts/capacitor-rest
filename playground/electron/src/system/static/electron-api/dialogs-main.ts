// window.Electron.dialogs bridge around Electron's native dialog APIs.
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { trustedIpcHandle } from '../../shared/functions';

function owner(e: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

trustedIpcHandle('dialogs:showOpenDialog', (e, options: Electron.OpenDialogOptions) =>
  owner(e) ? dialog.showOpenDialog(owner(e)!, options ?? {}) : dialog.showOpenDialog(options ?? {}));

trustedIpcHandle('dialogs:showSaveDialog', (e, options: Electron.SaveDialogOptions) =>
  owner(e) ? dialog.showSaveDialog(owner(e)!, options ?? {}) : dialog.showSaveDialog(options ?? {}));

trustedIpcHandle('dialogs:showMessageBox', (e, options: Electron.MessageBoxOptions) =>
  owner(e) ? dialog.showMessageBox(owner(e)!, options ?? { message: '' }) : dialog.showMessageBox(options ?? { message: '' }));

trustedIpcHandle('dialogs:showErrorBox', (_e, options: { title?: string; content?: string }) => {
  dialog.showErrorBox(options?.title ?? 'Error', options?.content ?? '');
});
