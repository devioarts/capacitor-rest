// Electron implementation of @capacitor/file-viewer
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { registerPlugin, type AnyRecord } from '../../shared/functions';

function pathFromMaybeFileUrl(value: string): string {
  if (value.startsWith('file://')) return fileURLToPath(value);
  return value;
}

function resourcePath(rel: string): string {
  const clean = rel.replace(/^[/\\]+/, '');
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', 'app');
  const resolved = path.resolve(base, clean);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Resource path escapes the app resources directory: ${rel}`);
  }
  return resolved;
}

async function openLocalPath(rawPath: string): Promise<void> {
  if (!rawPath) throw new Error('File path is required');
  const abs = path.resolve(pathFromMaybeFileUrl(rawPath));
  if (!fs.existsSync(abs)) throw new Error(`File does not exist: ${rawPath}`);
  const err = await shell.openPath(abs);
  if (err) throw new Error(err);
}

async function openUrl(rawUrl: string): Promise<void> {
  if (!rawUrl) throw new Error('URL is required');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error(`Malformed URL: ${rawUrl}`); }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    throw new Error(`Unsupported URL scheme for FileViewer: ${url.protocol}`);
  }
  await shell.openExternal(url.href);
}

/**
 * Capacitor FileViewer is "native only" upstream. On Electron, the native OS
 * file association is exactly the right desktop analogue: documents open in the
 * user's preferred PDF/image/text/etc. application.
 */
class FileViewer {
  async openDocumentFromLocalPath(opts: AnyRecord): Promise<void> {
    await openLocalPath(opts['path'] as string);
  }

  async openDocumentFromResources(opts: AnyRecord): Promise<void> {
    await openLocalPath(resourcePath(opts['path'] as string));
  }

  async openDocumentFromUrl(opts: AnyRecord): Promise<void> {
    await openUrl(opts['url'] as string);
  }

  async previewMediaContentFromLocalPath(opts: AnyRecord): Promise<void> {
    await this.openDocumentFromLocalPath(opts);
  }

  async previewMediaContentFromResources(opts: AnyRecord): Promise<void> {
    await this.openDocumentFromResources(opts);
  }

  async previewMediaContentFromUrl(opts: AnyRecord): Promise<void> {
    await this.openDocumentFromUrl(opts);
  }
}

registerPlugin('FileViewer', new FileViewer() as unknown as AnyRecord, [
  'openDocumentFromLocalPath',
  'openDocumentFromResources',
  'openDocumentFromUrl',
  'previewMediaContentFromLocalPath',
  'previewMediaContentFromResources',
  'previewMediaContentFromUrl',
]);
