// Internal app protocol for production builds that need web-style absolute paths
// (`/assets/logo.png`) without running the embedded localhost server.
import { protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ElectronAppProtocolConfig } from '../../shared/types';

export interface ResolvedAppProtocolConfig {
  scheme: string;
  hostname: string;
  handler: 'handle' | 'buffer';
  debug: boolean;
}

const DEFAULT_PROTOCOL: ResolvedAppProtocolConfig = {
  scheme: 'capacitor-electron',
  hostname: 'localhost',
  handler: 'buffer',
  debug: false,
};

const DEBUG_PATH = '/__cap_electron_protocol_debug';
const SCHEME_RE = /^[a-z][a-z0-9+.-]*$/i;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

const MIME: Record<string, string> = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.cjs':   'application/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.gif':   'image/gif',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.mp4':   'video/mp4',
  '.webm':  'video/webm',
  '.mp3':   'audio/mpeg',
  '.wav':   'audio/wav',
  '.pdf':   'application/pdf',
  '.wasm':  'application/wasm',
};

export function resolveAppProtocolConfig(config?: ElectronAppProtocolConfig): ResolvedAppProtocolConfig {
  const scheme = String(config?.scheme ?? DEFAULT_PROTOCOL.scheme).trim().toLowerCase().replace(/:\/\/$/, '').replace(/:$/, '');
  if (!SCHEME_RE.test(scheme)) throw new Error(`Invalid app protocol scheme: ${config?.scheme ?? scheme}`);

  const hostname = String(config?.hostname ?? DEFAULT_PROTOCOL.hostname).trim().toLowerCase();
  if (!HOSTNAME_RE.test(hostname)) throw new Error(`Invalid app protocol hostname: ${config?.hostname ?? hostname}`);

  const handler = config?.handler ?? DEFAULT_PROTOCOL.handler;
  if (handler !== 'handle' && handler !== 'buffer') throw new Error(`Invalid app protocol handler: ${String(handler)}`);

  return { scheme, hostname, handler, debug: config?.debug === true };
}

export function appProtocolUrl(config: ResolvedAppProtocolConfig, appPath = '/index.html'): string {
  const pathname = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return `${config.scheme}://${config.hostname}${pathname}`;
}

export function injectAppProtocolBase(html: string, config: ResolvedAppProtocolConfig): string {
  if (/<base(?:\s|>)/i.test(html)) return html;

  const baseTag = `<base href="${appProtocolUrl(config, '/')}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${baseTag}`);
  }

  return `${baseTag}${html}`;
}

export function isAppProtocolUrl(rawUrl: string, config: ResolvedAppProtocolConfig): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${config.scheme}:` && url.hostname === config.hostname;
  } catch {
    return false;
  }
}

export function registerAppProtocolPrivileges(config: ResolvedAppProtocolConfig): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: config.scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function resolveAppProtocolFilePath(distDir: string, requestUrl: string, config: ResolvedAppProtocolConfig): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${config.scheme}:` || url.hostname !== config.hostname) return null;

  const base = path.resolve(distDir);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(base, `.${pathname}`);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) return null;
  return filePath;
}

interface AppProtocolFileTarget {
  filePath: string;
  injectBase: boolean;
}

interface AppProtocolResponse {
  statusCode: number;
  data: Buffer;
  headers: Record<string, string>;
  text?: string;
}

async function fileOrIndex(distDir: string, requestUrl: string, config: ResolvedAppProtocolConfig): Promise<AppProtocolFileTarget | null> {
  const requestedPath = resolveAppProtocolFilePath(distDir, requestUrl, config);
  if (!requestedPath) return null;

  try {
    const stat = await fs.promises.stat(requestedPath);
    if (stat.isFile()) return { filePath: requestedPath, injectBase: path.basename(requestedPath).toLowerCase() === 'index.html' };
  } catch { /* fall back to index.html */ }

  if (path.extname(requestedPath)) return null;

  const indexPath = path.join(path.resolve(distDir), 'index.html');
  try {
    const stat = await fs.promises.stat(indexPath);
    return stat.isFile() ? { filePath: indexPath, injectBase: true } : null;
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dir)).slice(0, 100);
  } catch {
    return [];
  }
}

async function protocolDebugResponse(distDir: string, config: ResolvedAppProtocolConfig): Promise<AppProtocolResponse> {
  const base = path.resolve(distDir);
  const indexPath = path.join(base, 'index.html');
  const payload = {
    mode: config.handler,
    protocol: {
      scheme: config.scheme,
      hostname: config.hostname,
      debug: config.debug,
      rootUrl: appProtocolUrl(config, '/'),
    },
    distDir: base,
    indexPath,
    indexExists: await pathExists(indexPath),
    rootFiles: await readDirSafe(base),
    assetsFiles: await readDirSafe(path.join(base, 'assets')),
  };

  return {
    statusCode: 200,
    data: Buffer.from(JSON.stringify(payload, null, 2)),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    text: JSON.stringify(payload, null, 2),
  };
}

function errorResponse(err: unknown, requestUrl: string, config: ResolvedAppProtocolConfig): AppProtocolResponse {
  const message = err instanceof Error ? err.message : 'Internal app protocol error';
  const body = config.debug
    ? [
      'cap-electron protocol error',
      `url: ${requestUrl}`,
      `mode: ${config.handler}`,
      `error: ${message}`,
    ].join('\n')
    : message;

  return {
    statusCode: 500,
    data: Buffer.from(body),
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    text: body,
  };
}

async function resolveAppProtocolResponse(
  distDir: string,
  requestUrl: string,
  method: string,
  config: ResolvedAppProtocolConfig,
): Promise<AppProtocolResponse> {
  if (method !== 'GET' && method !== 'HEAD') {
    return {
      statusCode: 405,
      data: Buffer.alloc(0),
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      text: '',
    };
  }

  let pathname = '';
  try {
    pathname = new URL(requestUrl).pathname;
  } catch { /* invalid URLs fall through to normal 404 */ }

  if (config.debug && pathname === DEBUG_PATH) {
    return protocolDebugResponse(distDir, config);
  }

  const target = await fileOrIndex(distDir, requestUrl, config);
  if (!target) {
    return {
      statusCode: 404,
      data: Buffer.from(config.debug ? `Not found\nurl: ${requestUrl}` : 'Not found'),
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      text: config.debug ? `Not found\nurl: ${requestUrl}` : 'Not found',
    };
  }

  const { filePath } = target;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const headers = { 'Content-Type': contentType };

  if (method === 'HEAD') return { statusCode: 200, data: Buffer.alloc(0), headers, text: '' };

  if (target.injectBase && ext === '.html') {
    const html = await fs.promises.readFile(filePath, 'utf-8');
    const text = injectAppProtocolBase(html, config);
    return { statusCode: 200, data: Buffer.from(text), headers, text };
  }

  if (contentType.startsWith('text/')
    || contentType.startsWith('application/javascript')
    || contentType.startsWith('application/json')
    || contentType.startsWith('image/svg+xml')) {
    const text = await fs.promises.readFile(filePath, 'utf-8');
    return { statusCode: 200, data: Buffer.from(text), headers, text };
  }

  return { statusCode: 200, data: await fs.promises.readFile(filePath), headers };
}

function toFetchResponse(response: AppProtocolResponse): Response {
  return new Response(response.text ?? new Uint8Array(response.data), {
    status: response.statusCode,
    headers: response.headers,
  });
}

function setupAppProtocolHandle(distDir: string, config: ResolvedAppProtocolConfig): void {
  protocol.handle(config.scheme, async (request) => {
    try {
      return toFetchResponse(await resolveAppProtocolResponse(distDir, request.url, request.method, config));
    } catch (err) {
      return toFetchResponse(errorResponse(err, request.url, config));
    }
  });
}

function setupAppProtocolBuffer(distDir: string, config: ResolvedAppProtocolConfig): void {
  const ok = protocol.registerBufferProtocol(config.scheme, (request, callback) => {
    void (async () => {
      try {
        callback(await resolveAppProtocolResponse(distDir, request.url, request.method, config));
      } catch (err) {
        callback(errorResponse(err, request.url, config));
      }
    })();
  });

  if (!ok) throw new Error(`Failed to register app protocol: ${config.scheme}`);
}

export function setupAppProtocol(distDir: string, config: ResolvedAppProtocolConfig): void {
  if (config.handler === 'buffer') {
    setupAppProtocolBuffer(distDir, config);
    return;
  }

  setupAppProtocolHandle(distDir, config);
}
