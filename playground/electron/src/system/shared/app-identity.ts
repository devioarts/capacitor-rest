import * as path from 'path';

type JsonRecord = Record<string, unknown>;

export function resolveUserDataName(packageMeta: unknown, fallbackDisplayName?: string): string | null {
  if (!isRecord(packageMeta)) return toSafeUserDataName(fallbackDisplayName);

  const packageName = toSafeUserDataName(
    stringOrUndefined(packageMeta['desktopName']),
    stringOrUndefined(packageMeta['name']),
  );
  const displayName = toSafeUserDataName(
    fallbackDisplayName,
    stringOrUndefined(packageMeta['productName']),
  );

  if (packageName && packageName !== 'app') return packageName;
  if (displayName) return displayName;
  if (packageName) return packageName;

  return toSafeUserDataName(
    stringOrUndefined(packageMeta['desktopName']),
    stringOrUndefined(packageMeta['name']),
  );
}

export function resolveUserDataPath(appDataPath: string, packageMeta: unknown, fallbackDisplayName?: string): string | null {
  const userDataName = resolveUserDataName(packageMeta, fallbackDisplayName);
  return userDataName ? path.join(appDataPath, userDataName) : null;
}

function toSafeUserDataName(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate || candidate === '__APP_NAME__') continue;
    const safe = candidate
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/[-._]{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 214);

    if (safe) return safe;
  }

  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
