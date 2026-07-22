// Tiny localhost-only static server used when production serveMode is "server".
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { AddressInfo } from 'net';

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

/**
 * Start a local HTTP server serving static files from `distDir`.
 * Binds to 127.0.0.1 only — not reachable from outside the machine.
 * Resolves to the ephemeral port that was assigned.
 *
 * Unknown paths fall back to index.html (SPA routing support).
 *
 * Use when `serveMode: 'server'` is set in capacitor.config — required for
 * Web APIs that need an HTTP origin (WebUSB, WebBluetooth, Web Serial, etc.).
 */
export function startLocalServer(distDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const base = path.resolve(distDir);
    const indexPath = path.join(base, 'index.html');

    const server = http.createServer((req, res) => {
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      } catch {
        res.writeHead(400); res.end('Bad Request'); return;
      }

      if (pathname === '/') pathname = '/index.html';

      const filePath = path.resolve(base, '.' + pathname);

      // Guard against path traversal (covers %2e%2e, %5C, null-byte, backslash variants)
      if (filePath !== base && !filePath.startsWith(base + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      const ext = path.extname(filePath).toLowerCase();

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA fallback — serve index.html for unknown paths
          fs.readFile(indexPath, (err2, html) => {
            if (err2) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
        res.end(data);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
    server.on('error', reject);
  });
}
