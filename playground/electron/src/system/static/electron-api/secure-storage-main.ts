// Encrypted key/value storage bridge backed by Electron safeStorage and a JSON store.
import { app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { loadConfig, trustedIpcHandle } from '../../shared/functions';

type SecureStore = Record<string, string>;
type SecureStorageKeyMode = 'plain' | 'hashed';

let storeQueue: Promise<void> = Promise.resolve();
const { appCfg, cfg } = loadConfig();
const keyMode: SecureStorageKeyMode = cfg.app?.security?.secureStorageKeys === 'hashed' ? 'hashed' : 'plain';

function storePath(): string {
  return path.join(app.getPath('userData'), 'CapacitorStorage', 'secure-storage.json');
}

export function storageKey(key: string): string {
  if (keyMode === 'plain') return key;
  return createHash('sha256').update(`${appCfg.appId ?? app.getName()}:${key}`).digest('hex');
}

async function readStore(): Promise<SecureStore> {
  try {
    return JSON.parse(await fs.readFile(storePath(), 'utf-8')) as SecureStore;
  } catch {
    return {};
  }
}

async function writeStore(store: SecureStore): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

function withStore<T>(operation: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(operation, operation);
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function backend(): string {
  const fn = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
  return typeof fn === 'function' ? fn.call(safeStorage) : process.platform;
}

async function encrypt(value: string): Promise<string> {
  const api = safeStorage as unknown as { encryptStringAsync?: (plainText: string) => Promise<Buffer> };
  const buf = typeof api.encryptStringAsync === 'function'
    ? await api.encryptStringAsync(value)
    : safeStorage.encryptString(value);
  return buf.toString('base64');
}

async function decrypt(value: string): Promise<string> {
  const buf = Buffer.from(value, 'base64');
  const api = safeStorage as unknown as { decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt?: boolean }> };
  if (typeof api.decryptStringAsync === 'function') {
    return (await api.decryptStringAsync(buf)).result;
  }
  return safeStorage.decryptString(buf);
}

trustedIpcHandle('secureStorage:isEncryptionAvailable', () => safeStorage.isEncryptionAvailable());
trustedIpcHandle('secureStorage:getSelectedStorageBackend', () => backend());

trustedIpcHandle('secureStorage:set', async (_e, opts: { key: string; value: string }) => {
  if (!opts?.key) throw new Error('secureStorage.set requires a key');
  await withStore(async () => {
    const store = await readStore();
    store[storageKey(opts.key)] = await encrypt(String(opts.value ?? ''));
    await writeStore(store);
  });
});

trustedIpcHandle('secureStorage:get', async (_e, key: string) => {
  if (!key) throw new Error('secureStorage.get requires a key');
  return withStore(async () => {
    const store = await readStore();
    const value = store[storageKey(key)];
    return value == null ? null : await decrypt(value);
  });
});

trustedIpcHandle('secureStorage:remove', async (_e, key: string) => {
  await withStore(async () => {
    const store = await readStore();
    delete store[storageKey(key)];
    await writeStore(store);
  });
});

trustedIpcHandle('secureStorage:clear', async () => {
  await withStore(async () => {
    await writeStore({});
  });
});

trustedIpcHandle('secureStorage:keys', async () => withStore(async () => Object.keys(await readStore())));

trustedIpcHandle('secureStorage:encryptString', async (_e, value: string) => encrypt(String(value ?? '')));
trustedIpcHandle('secureStorage:decryptString', async (_e, value: string) => decrypt(String(value ?? '')));
