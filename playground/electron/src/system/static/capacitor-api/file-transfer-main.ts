// Electron implementation of @capacitor/file-transfer
import { emitPluginEvent, registerPlugin, type AnyRecord, type EventHooks } from '../../shared/functions';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

type HeadersRecord = Record<string, string>;

function normalizePath(raw: string): string {
  if (!raw) throw new Error('FileTransfer path is required');
  return path.resolve(raw.startsWith('file://') ? fileURLToPath(raw) : raw);
}

function appendParams(rawUrl: string, params: unknown): string {
  const url = new URL(rawUrl);
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.href;
}

function headersObject(headers: Headers): HeadersRecord {
  const out: HeadersRecord = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

function emitProgress(type: 'download' | 'upload', url: string, bytes: number, contentLength: number): void {
  emitPluginEvent('FileTransfer', 'progress', {
    type,
    url,
    bytes,
    contentLength,
    lengthComputable: contentLength > 0,
  });
}

class FileTransfer {
  async downloadFile(opts: AnyRecord): Promise<{ path: string }> {
    const url = appendParams(opts['url'] as string, opts['params']);
    const dest = normalizePath(opts['path'] as string);
    const method = (opts['method'] as string | undefined) ?? 'GET';
    const headers = (opts['headers'] as HeadersRecord | undefined) ?? {};
    const progress = opts['progress'] === true;

    const res = await fetch(url, { method, headers, redirect: opts['disableRedirects'] ? 'manual' : 'follow' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    await fsp.mkdir(path.dirname(dest), { recursive: true });

    const total = Number(res.headers.get('content-length') ?? 0);
    let transferred = 0;

    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(dest, buf);
      if (progress) emitProgress('download', url, buf.length, total || buf.length);
      return { path: dest };
    }

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      file.on('error', reject);
      file.on('finish', resolve);

      const reader = res.body!.getReader();
      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) {
            file.end();
            return;
          }
          transferred += value.byteLength;
          if (progress) emitProgress('download', url, transferred, total);
          file.write(Buffer.from(value), pump);
        }).catch(reject);
      };
      pump();
    });

    return { path: dest };
  }

  async uploadFile(opts: AnyRecord): Promise<{ bytesSent: number; responseCode: string; response: string; headers: HeadersRecord }> {
    const url = appendParams(opts['url'] as string, opts['params']);
    const src = normalizePath(opts['path'] as string);
    const stat = await fsp.stat(src);
    const headers = { ...((opts['headers'] as HeadersRecord | undefined) ?? {}) };
    const method = (opts['method'] as string | undefined) ?? 'POST';
    const progress = opts['progress'] === true;

    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = opts['mimeType'] as string | undefined ?? 'application/octet-stream';
    }

    if (progress) emitProgress('upload', url, 0, stat.size);
    const res = await fetch(url, {
      method,
      headers,
      body: fs.createReadStream(src) as unknown as BodyInit,
      // Node's fetch requires `duplex: "half"` for streamed request bodies.
      // The DOM lib bundled with TypeScript does not expose that Node extension.
      duplex: 'half',
    } as RequestInit);
    if (progress) emitProgress('upload', url, stat.size, stat.size);

    const response = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${response.slice(0, 200)}`);

    return {
      bytesSent: stat.size,
      responseCode: String(res.status),
      response,
      headers: headersObject(res.headers),
    };
  }
}

const events: EventHooks = { progress: {} };

registerPlugin('FileTransfer', new FileTransfer() as unknown as AnyRecord, ['downloadFile', 'uploadFile'], events);
