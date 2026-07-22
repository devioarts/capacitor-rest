// Electron implementation of @capacitor/preferences
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import { registerPlugin, loadConfig, type AnyRecord } from '../../shared/functions';

// ── In-memory store + disk persistence ───────────────────────────────────────

// Namespace by appId so multiple Capacitor apps in dev mode don't share storage.
// In production each app already has its own userData; this also protects dev.
const { appCfg, cfg } = loadConfig();

if (cfg.capacitorPlugins?.preferences !== false) {
  const appId      = appCfg.appId ?? app.getName();
  const store      = new Map<string, string>();
  const storeDir   = path.join(app.getPath('userData'), 'CapacitorStorage', appId);
  const storePath  = path.join(storeDir, 'preferences.json');
  const webPrefix  = 'CapacitorStorage.';
  const oldPrefix  = '_cap_';
  let persistQueue: Promise<void> = Promise.resolve();

  fssync.mkdirSync(storeDir, { recursive: true });

  try {
    const raw = JSON.parse(fssync.readFileSync(storePath, 'utf-8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') store.set(k, v);
    }
  } catch { /* file absent or corrupted on first run */ }

  function persist(): Promise<void> {
    const payload = JSON.stringify(Object.fromEntries(store));
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;

    // Async writes avoid blocking Electron's main process. The queue preserves
    // write order so older snapshots cannot land after newer Preferences changes.
    const write = persistQueue.then(async () => {
      await fs.writeFile(tmpPath, payload, 'utf-8');
      await fs.rename(tmpPath, storePath);
    });
    persistQueue = write.catch(() => undefined);
    return write;
  }

  // ── Plugin class ────────────────────────────────────────────────────────────

  /**
   * Electron implementation of the Capacitor Preferences plugin.
   *
   * Stores data in `userData/CapacitorStorage/{appId}/preferences.json`. An in-memory Map serves as a
   * write-through cache so reads never hit disk.
   *
   * Advantages over the web fallback (localStorage):
   * - Data survives "Clear browsing data" in Chromium.
   * - No 5-10 MB size limit.
   * - Accessible from the main process.
   *
   * Limitations:
   * - The `group` (namespace) option is ignored — all keys share one flat store.
   * - `migrate()` supports the default web fallback namespace only; custom groups are ignored.
   */
  class Preferences {
    async get(opts: AnyRecord): Promise<{ value: string | null }> {
      return { value: store.get(opts['key'] as string) ?? null };
    }

    async set(opts: AnyRecord): Promise<void> {
      store.set(opts['key'] as string, opts['value'] as string);
      await persist();
    }

    async remove(opts: AnyRecord): Promise<void> {
      store.delete(opts['key'] as string);
      await persist();
    }

    async clear(): Promise<void> {
      store.clear();
      await persist();
    }

    async keys(): Promise<{ keys: string[] }> {
      return { keys: [...store.keys()] };
    }

    async migrate(opts: AnyRecord): Promise<{ migrated: string[]; existing: string[] }> {
      const migrated: string[] = [];
      const existing: string[] = [];
      const candidates = new Map<string, string>();
      const localStorageEntries = opts['__localStorage'] as unknown;

      if (localStorageEntries && typeof localStorageEntries === 'object' && !Array.isArray(localStorageEntries)) {
        const entries = Object.entries(localStorageEntries as Record<string, unknown>);

        for (const [rawKey, value] of entries) {
          if (typeof value !== 'string' || !rawKey.startsWith(webPrefix)) continue;
          const key = rawKey.slice(webPrefix.length);
          if (key) candidates.set(key, value);
        }

        for (const [rawKey, value] of entries) {
          if (typeof value !== 'string' || !rawKey.startsWith(oldPrefix)) continue;
          const key = rawKey.slice(oldPrefix.length);
          if (key && !candidates.has(key)) candidates.set(key, value);
        }
      }

      for (const [key, value] of candidates) {
        if (store.has(key)) {
          existing.push(key);
        } else {
          store.set(key, value);
          migrated.push(key);
        }
      }

      if (migrated.length > 0) await persist();

      return { migrated, existing };
    }

    async removeOld(): Promise<void> {}
  }

  registerPlugin(
    'Preferences',
    new Preferences() as unknown as AnyRecord,
    ['get', 'set', 'remove', 'clear', 'keys', 'migrate', 'removeOld'],
  );
}
