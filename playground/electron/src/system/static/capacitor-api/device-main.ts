// Electron implementation of @capacitor/device
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { registerPlugin, type AnyRecord } from '../../shared/functions';

type OperatingSystem = 'ios' | 'android' | 'windows' | 'mac' | 'unknown';

function operatingSystem(): OperatingSystem {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return 'unknown';
}

function readInstallId(): string {
  const dir = path.join(app.getPath('userData'), 'CapacitorStorage');
  const file = path.join(dir, 'device-id');
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing) return existing;
  } catch { /* first launch */ }

  const id = randomUUID();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, id + '\n', { mode: 0o600 });
  return id;
}

/**
 * Device exposes support/debug information that the browser deliberately hides
 * or rounds for privacy. The values are desktop-flavoured but keep Capacitor's
 * field names so existing app code can reuse the same diagnostics screen.
 */
class Device {
  async getId(): Promise<{ identifier: string }> {
    return { identifier: readInstallId() };
  }

  async getInfo(): Promise<AnyRecord> {
    return {
      name: os.hostname(),
      model: `${os.platform()}-${os.arch()}`,
      platform: 'electron',
      operatingSystem: operatingSystem(),
      osVersion: os.release(),
      manufacturer: process.platform === 'darwin' ? 'Apple' : process.platform === 'win32' ? 'Microsoft' : 'Unknown',
      isVirtual: false,
      memUsed: process.memoryUsage().rss,
      webViewVersion: process.versions.chrome,
    };
  }

  async getBatteryInfo(): Promise<{ batteryLevel?: number; isCharging?: boolean }> {
    // Electron does not expose battery percentage/charging state directly.
    // Returning no fields is more honest than inventing desktop battery data.
    return {};
  }

  async getLanguageCode(): Promise<{ value: string }> {
    const tag = app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale || 'en';
    return { value: tag.split(/[-_]/)[0] || tag };
  }

  async getLanguageTag(): Promise<{ value: string }> {
    return { value: app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale || 'en-US' };
  }
}

registerPlugin('Device', new Device() as unknown as AnyRecord, [
  'getId',
  'getInfo',
  'getBatteryInfo',
  'getLanguageCode',
  'getLanguageTag',
]);
