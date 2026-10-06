import { NativeModule, requireNativeModule } from 'expo';

import type {
  CertificateInfo,
  HttpRequestOptions,
  HttpResponse,
  LiveMonitorConfig,
  LiveMonitorState,
  LiveMonitorSupport,
  LiveMonitorUpdate,
  NetworkInfo,
  RouteLinkNativeEvents,
  SshExecResult,
  SshHostKey,
  SshKeyPair,
  SshOptions,
} from './RouteLinkNative.types';

declare class RouteLinkNativeModule extends NativeModule<RouteLinkNativeEvents> {
  httpRequest(options: HttpRequestOptions): Promise<HttpResponse>;
  fetchServerCertificate(url: string, timeoutMs?: number): Promise<CertificateInfo>;
  getNetworkInfo(): Promise<NetworkInfo>;
  /** Android only; iOS rejects with ERR_UNSUPPORTED (broadcast needs Apple's multicast entitlement). */
  sendWakeOnLan(mac: string, broadcast?: string, port?: number): Promise<void>;
  /** Resolves after `ms`. JavaScript timers do not run when Android starts the app headless for a background task. */
  sleep(ms: number): Promise<void>;

  sshGenerateKey(comment: string): Promise<SshKeyPair>;
  sshPublicKey(seed: string, comment: string): Promise<string>;
  /** Connects only far enough to read the server's key, for the user to confirm before it is pinned. */
  sshHostKey(host: string, port: number, timeoutMs?: number): Promise<SshHostKey>;
  /** An interactive shell with a PTY; output arrives as onSshData events. Resolves with the session id. */
  sshOpen(options: SshOptions): Promise<string>;
  /** data: base64 */
  sshWrite(id: string, data: string): Promise<void>;
  sshResize(id: string, cols: number, rows: number): Promise<void>;
  sshClose(id: string): Promise<void>;
  /** A one-off command on its own connection. */
  sshExec(options: SshOptions, command: string, timeoutMs?: number): Promise<SshExecResult>;

  // Live monitor (design §16). Android only; iOS rejects with ERR_UNSUPPORTED.
  /** Starts the foreground service, or replaces the running monitor (one router at a time). */
  startLiveMonitor(config: LiveMonitorConfig): Promise<void>;
  /** Ignored when nothing runs. */
  updateLiveMonitor(update: LiveMonitorUpdate): Promise<void>;
  stopLiveMonitor(): Promise<void>;
  getLiveMonitorState(): Promise<LiveMonitorState>;
  clearLiveMonitorInterruption(): Promise<void>;
  getLiveMonitorSupport(): Promise<LiveMonitorSupport>;
  canPostPromotedNotifications(): Promise<boolean>;
  /** Each resolves false when no settings page could be opened. */
  openPromotedNotificationSettings(): Promise<boolean>;
  openNotificationSettings(): Promise<boolean>;
  /** Asks to be left out of battery optimisation, or opens the list when that is not possible. */
  openBatteryOptimizationSettings(): Promise<boolean>;
}

export default requireNativeModule<RouteLinkNativeModule>('RouteLinkNative');
