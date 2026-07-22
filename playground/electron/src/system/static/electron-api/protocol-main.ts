// Custom protocol and shell.openExternal bridge with scheme allowlist validation.
import { app, protocol, shell } from 'electron';
import { loadConfig, trustedIpcHandle } from '../../shared/functions';

const SCHEME_RE = /^[a-z][a-z0-9+.-]*$/i;

export function cleanScheme(raw: string): string {
  const scheme = String(raw ?? '').trim().toLowerCase().replace(/:\/\/$/, '').replace(/:$/, '');
  if (!SCHEME_RE.test(scheme)) throw new Error(`Invalid protocol scheme: ${raw}`);
  return scheme;
}

function configuredSchemes(): string[] {
  const { cfg } = loadConfig();
  return [
    cfg.app?.deepLinkingScheme,
    ...(Array.isArray(cfg.app?.appLauncherSchemes) ? cfg.app.appLauncherSchemes : []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(cleanScheme);
}

trustedIpcHandle('protocol:getConfiguredSchemes', () => [...new Set(configuredSchemes())]);
trustedIpcHandle('protocol:isProtocolHandled', (_e, scheme: string) => protocol.isProtocolHandled(cleanScheme(scheme)));
trustedIpcHandle('protocol:isDefaultProtocolClient', (_e, scheme: string) => app.isDefaultProtocolClient(cleanScheme(scheme)));

trustedIpcHandle('protocol:setAsDefaultProtocolClient', (_e, scheme: string) => {
  const clean = cleanScheme(scheme);
  if (!configuredSchemes().includes(clean)) {
    throw new Error(`Refusing to register unconfigured protocol scheme: ${clean}`);
  }
  return app.setAsDefaultProtocolClient(clean);
});

trustedIpcHandle('protocol:removeAsDefaultProtocolClient', (_e, scheme: string) =>
  app.removeAsDefaultProtocolClient(cleanScheme(scheme)));

trustedIpcHandle('protocol:openExternal', async (_e, url: string) => {
  const parsed = new URL(url);
  if (!['http:', 'https:', 'mailto:', ...configuredSchemes().map((s) => `${s}:`)].includes(parsed.protocol)) {
    throw new Error(`Protocol is not allowed for openExternal: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.href);
});
