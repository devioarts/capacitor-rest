// window.Electron.print bridge for native printing and print-to-PDF generation.
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { trustedIpcHandle } from '../../shared/functions';

function win(e: IpcMainInvokeEvent): BrowserWindow {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) throw new Error('No BrowserWindow for print request');
  return w;
}

trustedIpcHandle('print:getPrinters', (e) => win(e).webContents.getPrintersAsync());

trustedIpcHandle('print:print', (e, options: Electron.WebContentsPrintOptions) =>
  new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
    win(e).webContents.print(options ?? {}, (success, failureReason) => {
      resolve({ success, failureReason: failureReason || undefined });
    });
  }));

trustedIpcHandle('print:printToPDF', async (e, opts: { options?: Electron.PrintToPDFOptions; path?: string }) => {
  const data = await win(e).webContents.printToPDF(opts?.options ?? {});
  if (opts?.path) {
    const dest = path.resolve(opts.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    return { path: dest };
  }
  return { data: data.toString('base64') };
});
