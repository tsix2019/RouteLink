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

export type RouteLinkNativeEvents = {
  /** Terminal output, base64 (a chunk may end inside a UTF-8 sequence). */
  onSshData(event: { id: string; data: string }): void;
  /** The shell ended: error is set when the connection broke rather than closed. */
  onSshClosed(event: { id: string; error?: string | null }): void;
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
