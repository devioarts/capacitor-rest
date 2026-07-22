import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { resolveUserDataPath } from './app-identity';

type JsonRecord = Record<string, unknown>;

const packageMeta = readJson(path.join(__dirname, '..', 'package.json'));
const capacitorConfig = readJson(path.join(__dirname, '..', 'capacitor.config.json'));
const displayName = stringOrUndefined(capacitorConfig?.['appName'])
  ?? stringOrUndefined(packageMeta?.['productName']);
const userDataPath = resolveUserDataPath(app.getPath('appData'), packageMeta, displayName);

if (userDataPath && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', userDataPath);
}

function readJson(file: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
