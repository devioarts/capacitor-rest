// ── Power Monitor ─────────────────────────────────────────────────────────────

export type PowerMonitorEventName =
  | 'suspend'
  | 'resume'
  | 'lock-screen'
  | 'unlock-screen'
  | 'on-battery'
  | 'on-ac'
  | 'shutdown';

export type IdleState = 'active' | 'idle' | 'locked' | 'unknown';

// ── Power Save Blocker ───────────────────────────────────────────────────────

export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

// ── Screen / Display ──────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElectronDisplay {
  id: number;
  label: string;
  bounds: Rect;
  workArea: Rect;
  size: { width: number; height: number };
  workAreaSize: { width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  touchSupport: 'available' | 'unavailable' | 'unknown';
  accelerometerSupport: 'available' | 'unavailable' | 'unknown';
  colorDepth: number;
  colorSpace: string;
  depthPerComponent: number;
  displayFrequency: number;
  detected: boolean;
  monochrome: boolean;
}

export type ScreenEventName = 'display-added' | 'display-removed' | 'display-metrics-changed';

export interface ScreenEventPayload {
  type: ScreenEventName;
  data: ElectronDisplay | { display: ElectronDisplay; changedMetrics: string[] };
}

export interface UpdateInfo {
  version: string;
  releaseNotes?: string | string[] | null;
  releaseDate?: string;
  [key: string]: unknown;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdaterEventMap {
  'checking-for-update':  void;
  'update-available':     UpdateInfo;
  'update-not-available': UpdateInfo;
  'download-progress':    DownloadProgress;
  'update-downloaded':    UpdateInfo;
  'error':                { message: string };
}

export type UpdaterEventName = keyof UpdaterEventMap;

export interface UpdaterBridge {
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
  /** Subscribe to an updater event. Returns an unsubscribe function. */
  on<K extends UpdaterEventName>(event: K, callback: (data: UpdaterEventMap[K]) => void): () => void;
}

export interface ElectronDialogsBridge {
  showOpenDialog(options?: unknown): Promise<unknown>;
  showSaveDialog(options?: unknown): Promise<unknown>;
  showMessageBox(options: unknown): Promise<unknown>;
  showErrorBox(options: { title?: string; content?: string }): Promise<void>;
}

export interface SecureStorageBridge {
  isEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): Promise<string>;
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  encryptString(value: string): Promise<string>;
  decryptString(value: string): Promise<string>;
}

export interface ProtocolBridge {
  getConfiguredSchemes(): Promise<string[]>;
  isProtocolHandled(scheme: string): Promise<boolean>;
  isDefaultProtocolClient(scheme: string): Promise<boolean>;
  setAsDefaultProtocolClient(scheme: string): Promise<boolean>;
  removeAsDefaultProtocolClient(scheme: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

export interface SessionBridge {
  clearCache(): Promise<void>;
  clearStorageData(options?: unknown): Promise<void>;
  getUserAgent(): Promise<string>;
  setUserAgent(userAgent: string): Promise<void>;
  resolveProxy(url: string): Promise<string>;
  setProxy(config: unknown): Promise<void>;
  closeAllConnections(): Promise<void>;
  getCookies(filter?: unknown): Promise<unknown[]>;
  setCookie(cookie: unknown): Promise<void>;
  removeCookie(options: { url: string; name: string }): Promise<void>;
}

export interface DownloadState {
  id: string;
  url: string;
  filename: string;
  savePath?: string;
  state: 'requested' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadsBridge {
  start(options: { url: string; savePath?: string }): Promise<DownloadState>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  getActive(): Promise<DownloadState[]>;
  on(callback: (event: { type: string; data: DownloadState }) => void): () => void;
}

export interface PrintBridge {
  getPrinters(): Promise<unknown[]>;
  print(options?: unknown): Promise<{ success: boolean; failureReason?: string }>;
  printToPDF(options?: { options?: unknown; path?: string }): Promise<{ path: string } | { data: string }>;
}

export interface DesktopCaptureSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail?: string;
  appIcon?: string;
}

export interface DesktopCaptureBridge {
  getSources(options?: { types?: Array<'window' | 'screen'>; thumbnailSize?: { width: number; height: number }; fetchWindowIcons?: boolean }): Promise<DesktopCaptureSource[]>;
}

export interface AutoLaunchBridge {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  getSettings(): Promise<unknown>;
}

export interface NativeThemeSnapshot {
  shouldUseDarkColors: boolean;
  themeSource: 'system' | 'light' | 'dark';
  shouldUseHighContrastColors: boolean;
  shouldUseInvertedColorScheme: boolean;
}

export interface NativeThemeBridge {
  get(): Promise<NativeThemeSnapshot>;
  setThemeSource(source: NativeThemeSnapshot['themeSource']): Promise<NativeThemeSnapshot>;
  onUpdated(callback: (data: NativeThemeSnapshot) => void): () => void;
}

export interface ManagedWindowInfo {
  id: number;
  title: string;
  bounds: Rect;
  isVisible: boolean;
  isFocused: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
  isDestroyed: boolean;
}

export interface ManagedWindowCreateOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  title?: string;
  modal?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;
  backgroundColor?: string;
  show?: boolean;
  /**
   * Internal app route/path. Trusted content; receives the full preload bridge.
   * Use `#/settings` for routes that must also work in production file mode.
   */
  appPath?: string;
  /**
   * External http(s) URL. Untrusted content; opened without the preload bridge.
   */
  url?: string;
}

export interface WindowsBridge {
  create(options?: ManagedWindowCreateOptions): Promise<ManagedWindowInfo>;
  list(): Promise<ManagedWindowInfo[]>;
  focus(id: number): Promise<void>;
  close(id: number): Promise<void>;
  show(id: number): Promise<void>;
  hide(id: number): Promise<void>;
  setBounds(id: number, bounds: Rect): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export type MenuActionSource = 'app' | 'context' | 'dock' | 'tray';

export interface MenuActionEvent {
  source: MenuActionSource;
  action: string;
  data?: unknown;
}

export type ContextMenuTrigger = 'right-click' | 'renderer';

export interface ContextMenuTarget {
  id?: string;
  tagName?: string;
  className?: string;
  classList?: string[];
  dataset?: Record<string, string>;
  text?: string;
  href?: string;
  src?: string;
  value?: string;
}

export interface ShowContextMenuOptions {
  /** Window-relative x coordinate. Defaults to the current cursor position. */
  x?: number;
  /** Window-relative y coordinate. Defaults to the current cursor position. */
  y?: number;
  /** Optional target metadata used by `electron/src/user/menu/context.ts`. */
  target?: Partial<ContextMenuTarget>;
  /** Arbitrary app data forwarded to `ContextMenuContext.data`. */
  data?: unknown;
}

export interface ElectronBridge {
  quit():                       Promise<void>;
  minimize():                   Promise<void>;
  maximize():                   Promise<void>;
  unmaximize():                 Promise<void>;
  toggleMaximize():             Promise<void>;
  isMaximized():                Promise<boolean>;
  setFullscreen(flag: boolean): Promise<void>;
  isFullscreen():               Promise<boolean>;
  focus():                      Promise<void>;
  reload():                     Promise<void>;
  openDevTools():               Promise<void>;
  closeDevTools():              Promise<void>;
  getAppVersion():              Promise<string>;
  /** Auto-updater bridge. No-op handlers when app.autoUpdater.enabled is false. */
  updater: UpdaterBridge;
  dialogs: ElectronDialogsBridge;
  secureStorage: SecureStorageBridge;
  protocols: ProtocolBridge;
  session: SessionBridge;
  downloads: DownloadsBridge;
  print: PrintBridge;
  desktopCapture: DesktopCaptureBridge;
  autoLaunch: AutoLaunchBridge;
  nativeTheme: NativeThemeBridge;
  windows: WindowsBridge;
  /**
   * Subscribe to incoming deep link URLs. Returns an unsubscribe function.
   * No-op handler when app.deepLinkingScheme is not set in capacitor.config.
   */
  onDeepLink?(callback: (data: { url: string }) => void): () => void;
  /**
   * Register a global shortcut from the renderer at runtime.
   * When triggered, the shortcut fires `onShortcut()` with the given `event` name.
   * Returns `true` if registration succeeded, `false` if the accelerator is already
   * taken by another application.
   *
   * The shortcut is automatically unregistered when the app quits.
   * Call `unregisterShortcut()` to remove it earlier.
   *
   * @param accelerator Electron accelerator string, e.g. `'CmdOrCtrl+Shift+K'`.
   * @param event       Arbitrary event name forwarded to `onShortcut()`.
   */
  registerShortcut(accelerator: string, event: string): Promise<boolean>;
  /**
   * Unregister a global shortcut that was previously registered via `registerShortcut()`.
   *
   * @param accelerator The accelerator string passed to `registerShortcut()`.
   */
  unregisterShortcut(accelerator: string): Promise<void>;
  /**
   * Subscribe to global shortcut events sent from the main process.
   * Returns an unsubscribe function — call it on component unmount to avoid memory leaks.
   *
   * @example
   * useEffect(() => {
   *   return window.Electron.onShortcut(({ event }) => {
   *     if (event === 'open-search') setSearchOpen(true);
   *   });
   * }, []);
   */
  onShortcut(callback: (data: { event: string }) => void): () => void;
  /**
   * Show the configured native context menu from renderer code. The menu template
   * still comes from `electron/src/user/menu/context.ts`; renderer code only
   * supplies target metadata and optional data.
   */
  showContextMenu(options?: ShowContextMenuOptions): Promise<boolean>;
  /** Subscribe to actions emitted by native app/context/dock/tray menus. */
  onMenuAction(callback: (event: MenuActionEvent) => void): () => void;

  // ── Badge count ─────────────────────────────────────────────────────────────
  /** Set the dock/taskbar badge count. Returns false on unsupported platforms. */
  setBadgeCount(count: number): Promise<boolean>;
  getBadgeCount(): Promise<number>;

  // ── Power Monitor ───────────────────────────────────────────────────────────
  /** Subscribe to power monitor events (suspend/resume/lock-screen etc.). Returns unsubscribe fn. */
  onPowerMonitorEvent(callback: (data: { type: PowerMonitorEventName }) => void): () => void;
  /** Returns whether the system is active, idle, locked, or unknown. */
  getPowerMonitorIdleState(idleThreshold: number): Promise<IdleState>;
  /** Returns the time in seconds since the last user input. */
  getPowerMonitorIdleTime(): Promise<number>;

  // ── Power Save Blocker ─────────────────────────────────────────────────────
  /** Prevent the app or display from entering lower-power mode. Returns the blocker id. */
  startPowerSaveBlocker(type: PowerSaveBlockerType): Promise<number>;
  /** Stop a previously started power save blocker. Returns false when the id is not active. */
  stopPowerSaveBlocker(id: number): Promise<boolean>;
  /** Returns whether the given power save blocker id is currently active. */
  isPowerSaveBlockerStarted(id: number): Promise<boolean>;

  // ── Screen / Display ────────────────────────────────────────────────────────
  getAllDisplays(): Promise<ElectronDisplay[]>;
  getPrimaryDisplay(): Promise<ElectronDisplay>;
  getCursorScreenPoint(): Promise<{ x: number; y: number }>;
  /** Returns the display under the current cursor position. */
  getCursorDisplay(): Promise<ElectronDisplay>;
  /** Subscribe to display change events (added/removed/metrics-changed). Returns unsubscribe fn. */
  onScreenEvent(callback: (data: ScreenEventPayload) => void): () => void;

  // ── Process guardian ────────────────────────────────────────────────────────
  /** Subscribe to uncaught main-process errors (uncaughtException / unhandledRejection). Returns unsubscribe fn. */
  onElectronError(callback: (data: { message: string; stack: string | undefined; type: 'exception' | 'rejection' }) => void): () => void;
}
