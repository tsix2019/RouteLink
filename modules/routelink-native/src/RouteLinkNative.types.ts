/** How the server certificate is validated for an HTTPS request. */
export type TlsOptions =
  | { mode: 'system' }
  /** Accept only a leaf certificate with this SHA-256 (lower-case hex, no colons). Hostname is not checked. */
  | { mode: 'pinned'; sha256: string }
  /** Accept any certificate. Discovery probes only — never send credentials with it. */
  | { mode: 'insecure-probe' };

export interface HttpRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  /** Total request timeout; defaults to 10000. */
  timeoutMs?: number;
  /** Defaults to { mode: 'system' }. */
  tls?: TlsOptions;
  /** 'base64' returns a binary body base64-encoded (backups); defaults to text. */
  responseEncoding?: 'utf8' | 'base64';
}

/** Redirects are never followed and no cookie jar is used. Header names are lower-case. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string[]>;
  body: string;
}

export interface CertificateInfo {
  /** SHA-256 of the DER-encoded leaf certificate, lower-case hex without colons. */
  sha256: string;
  subject: string;
  issuer: string;
  /** ISO 8601, empty when the platform does not expose it. */
  notBefore: string;
  notAfter: string;
}

export interface NetworkInfo {
  isWifi: boolean;
  ip: string | null;
  netmask: string | null;
  gateway: string | null;
  ifname: string | null;
}

export interface SshOptions {
  host: string;
  /** Defaults to 22. */
  port?: number;
  /** Defaults to root. */
  username?: string;
  password?: string;
  /** The app key's 32-byte ed25519 seed (base64); used instead of the password when set. */
  keySeed?: string;
  /** The pinned host key, "SHA256:…" as OpenSSH prints it. sshHostKey reads it on the first connection. */
  hostKey: string;
  /** Terminal size for sshOpen. */
  cols?: number;
  rows?: number;
  /** TCP connect, key exchange and login, each; defaults to 10000. */
  timeoutMs?: number;
}

export interface SshHostKey {
  /** e.g. ssh-ed25519 */
  type: string;
  /** "SHA256:…" without padding, as OpenSSH prints it. */
  fingerprint: string;
}

export interface SshKeyPair {
  /** 32-byte ed25519 seed, base64. Secret: keep it in the secure store. */
  seed: string;
  /** authorized_keys line: "ssh-ed25519 AAAA… comment". */
  publicKey: string;
}

export interface SshExecResult {
  /** null when the command died from a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

// ---- Live monitor (Android foreground service, design §16) ----

/**
 * Notification texts, already localised: the service has no strings of its own. Placeholders in braces:
 * {rx} {tx} {online} {name} {rate} {duration}, and {h} {m} {s} in the duration templates.
 */
export interface LiveMonitorTexts {
  /** Name of the notification channel in the system settings. */
  channel: string;
  /** "↓ {rx} ↑ {tx} · {online} online" */
  line: string;
  /** The same without the online count (not known yet, or not readable). */
  lineNoCount: string;
  /** Second line: "Busiest: {name} {rate}", {rate} being e.g. "↓ 8.1 Mbps". Needs the plugin. */
  top: string;
  connecting: string;
  /** Title after two failed polls in a row (LU-3). */
  offlineTitle: string;
  /** "Can't reach {name}, trying again" */
  offlineText: string;
  /** Status-bar chip while offline, at most 7 characters. */
  offlineChip: string;
  /** "Back online (offline for {duration})", shown for one refresh. */
  recovered: string;
  /** The router no longer knows the session: "open the app to reconnect". */
  sessionExpired: string;
  /** Other failures (unexpected answers). */
  error: string;
  /** The notification's Stop action. */
  stop: string;
  /** Notification left behind when the monitor stops on a certificate problem. */
  stoppedTitle: string;
  stoppedTls: string;
  sec: string;
  minSec: string;
  hourMin: string;
}

/** A JSON-RPC session the app logged in; the service never logs in itself. */
export interface LiveMonitorSession {
  /** URL taking JSON-RPC ubus calls (/ubus, or LuCI's /cgi-bin/luci/admin/ubus). */
  endpoint: string;
  sid: string;
  /** LuCI login: the sysauth cookie. */
  cookie?: string;
}

/** Rates in bits per second. */
export interface LiveMonitorSample {
  rxBps: number;
  txBps: number;
  /** Devices online; leave out when unknown. */
  online?: number;
  /** Busiest devices (plugin), for the second line. */
  devices?: { mac: string; rxBps: number; txBps: number }[];
}

export interface LiveMonitorConfig {
  routerId: string;
  /** Notification title. */
  routerName: string;
  /**
   * agent: one `routelink live` per refresh. luci: `luci-rpc getNetworkDevices` WAN counters every refresh,
   * `ip -4 neigh show` every 10 s for the online count. demo: made up around `sample`.
   */
  source: 'agent' | 'luci' | 'demo';
  /** Required unless source is demo. */
  session?: LiveMonitorSession;
  /** Pinned certificate (lower-case hex); the system trust store otherwise. */
  tlsSha256?: string;
  /** Layer-3 WAN device: its counters, and left out of the online count. Required for luci; agent falls back to luci with it. */
  wanDevice?: string;
  /** Refresh interval, 1–60 s. */
  intervalSec: number;
  /** Ends by itself after this many minutes; null or 0: until stopped. */
  durationMin: number | null;
  /** MAC (any case) → name for the busiest-device line. */
  names: Record<string, string>;
  texts: LiveMonitorTexts;
  /** What the app shows right now: the notification starts with it (and the demo drifts around it). */
  sample?: LiveMonitorSample;
  /** Opened by tapping the notification, e.g. routelink://overview. */
  link: string;
  /** #RRGGBB tint of the notification icon. */
  color?: string;
}

/** Everything optional: the overview hands over what it has. */
export interface LiveMonitorUpdate {
  routerName?: string;
  names?: Record<string, string>;
  /** A fresh sample of the app's own polling; the service skips its next request. */
  sample?: LiveMonitorSample;
  /** A new login after the session expired. */
  session?: LiveMonitorSession;
  intervalSec?: number;
}

export type LiveMonitorStatus = 'starting' | 'ok' | 'offline' | 'error' | 'session-expired';
/** user: Stop action or stopLiveMonitor; timeout: the chosen duration ended; error: certificate; system: killed. */
export type LiveMonitorStopReason = 'user' | 'timeout' | 'error' | 'system';

export interface LiveMonitorRecord {
  routerId: string;
  routerName: string;
  /** ms since the epoch */
  startedAt: number;
  endsAt: number | null;
}

export interface LiveMonitorState {
  running: boolean;
  routerId?: string;
  routerName?: string;
  source?: 'agent' | 'luci' | 'demo';
  startedAt?: number;
  /** null: until stopped */
  endsAt?: number | null;
  intervalSec?: number;
  status?: LiveMonitorStatus;
  /** The last monitor was ended by the system (process killed), until clearLiveMonitorInterruption. */
  interrupted: LiveMonitorRecord | null;
}

export interface LiveMonitorSupport {
  sdkInt: number;
  /** Android 16 QPR (API 36.1) or later: promoted notifications and the status-bar chip. */
  promotion: boolean;
  /** The user allows this app's promoted notifications (always false without `promotion`). */
  canPostPromoted: boolean;
  /** App notifications and the live monitor's channel are on. */
  notificationsEnabled: boolean;
  ignoringBatteryOptimizations: boolean;
  manufacturer: string;
  brand: string;
}

export type RouteLinkNativeEvents = {
  /** Terminal output, base64 (a chunk may end inside a UTF-8 sequence). */
  onSshData(event: { id: string; data: string }): void;
  /** The shell ended: error is set when the connection broke rather than closed. */
  onSshClosed(event: { id: string; error?: string | null }): void;
  /** The live monitor ended; message is "tls" for a certificate problem. */
  onLiveMonitorStopped(event: {
    reason: LiveMonitorStopReason;
    routerId?: string | null;
    message?: string | null;
  }): void;
  onLiveMonitorStatus(event: { status: LiveMonitorStatus; routerId: string }): void;
};

export type NativeErrorCode =
  | 'ERR_TIMEOUT'
  | 'ERR_UNREACHABLE'
  | 'ERR_DNS'
  | 'ERR_TLS_UNTRUSTED'
  | 'ERR_TLS_PIN_MISMATCH'
  | 'ERR_NETWORK'
  | 'ERR_UNSUPPORTED'
  | 'ERR_INVALID_ARGUMENT'
  | 'SSH_HOST_KEY_CHANGED'
  | 'SSH_AUTH_FAILED';
