// Electron implementation of @capacitor/browser and @capacitor/app-launcher
import { shell } from 'electron';
import { loadConfig, registerPlugin, type AnyRecord, type EventHooks } from '../../shared/functions';
import { closeElectronWebView, openElectronWebView } from './in-app-browser-main';

// Browser is intentionally web-only. AppLauncher may opt custom schemes in via
// plugins.Electron.app.appLauncherSchemes.
const WEB_SCHEMES = new Set(['http:', 'https:']);
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*$/i;

const { cfg } = loadConfig();
const appLauncherSchemes = normalizeSchemes(cfg.app?.appLauncherSchemes);

function normalizeSchemes(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();

  const schemes = value
    .filter((scheme): scheme is string => typeof scheme === 'string')
    .map((scheme) => scheme.trim().toLowerCase().replace(/:\/\/$/, '').replace(/:$/, ''))
    .filter((scheme) => SCHEME_RE.test(scheme))
    .map((scheme) => `${scheme}:`)
    .filter((scheme) => !BLOCKED_SCHEMES.has(scheme));

  return new Set(schemes);
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

function isBrowserUrlAllowed(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol !== null && WEB_SCHEMES.has(protocol);
}

function isAppLauncherUrlAllowed(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol !== null && !BLOCKED_SCHEMES.has(protocol) && (WEB_SCHEMES.has(protocol) || appLauncherSchemes.has(protocol));
}

// ── @capacitor/browser ────────────────────────────────────────────────────────

/**
 * Electron implementation of the Capacitor Browser plugin.
 *
 * Uses an Electron-owned WebView window so close/load events can be delivered.
 *
 * Limitations:
 * - `windowName` is ignored because Electron does not use `window.open`.
 */
class Browser {
  async open(opts: AnyRecord): Promise<void> {
    const url = opts['url'] as string;
    if (!isBrowserUrlAllowed(url)) throw new Error(`Browser.open only supports http/https URLs: ${url}`);
    await openElectronWebView({
      url,
      options: {
        showToolbar: true,
        showURL: true,
        showNavigationButtons: false,
        closeButtonText: 'Close',
        toolbarColor: opts['toolbarColor'],
        electron: {
          window: {
            width: opts['width'],
            height: opts['height'],
            fullscreen: opts['presentationStyle'] === 'fullscreen',
            title: 'Browser',
          },
        },
      },
    }, {
      plugin: 'Browser',
      closed: 'browserFinished',
      loaded: 'browserPageLoaded',
    });
  }

  async close(): Promise<void> {
    closeElectronWebView();
  }
}

const browserEvents: EventHooks = {
  browserFinished: {},
  browserPageLoaded: {},
};

registerPlugin('Browser', new Browser() as unknown as AnyRecord, ['open', 'close'], browserEvents);

// ── @capacitor/app-launcher ───────────────────────────────────────────────────

/**
 * Electron implementation of the Capacitor AppLauncher plugin.
 *
 * Uses `shell.openExternal` to open URLs / app deep-link URIs.
 *
 * Limitations:
 * - `canOpenUrl()` returns `{ value: false }` for schemes rejected by the local
 *   allowlist, similar to undeclared iOS/Android schemes. `{ value: true }`
 *   means the URL is allowed, not that an OS handler exists.
 * - Android package-name inputs are not supported; Electron's shell.openExternal
 *   requires a URL.
 */
class AppLauncher {
  async canOpenUrl(opts: AnyRecord): Promise<{ value: boolean }> {
    const url = opts['url'] as string;
    return { value: isAppLauncherUrlAllowed(url) };
  }

  async openUrl(opts: AnyRecord): Promise<{ completed: boolean }> {
    const url = opts['url'] as string;
    if (!isAppLauncherUrlAllowed(url)) return { completed: false };
    try {
      await shell.openExternal(url);
      return { completed: true };
    } catch {
      return { completed: false };
    }
  }
}

registerPlugin('AppLauncher', new AppLauncher() as unknown as AnyRecord, ['canOpenUrl', 'openUrl']);
