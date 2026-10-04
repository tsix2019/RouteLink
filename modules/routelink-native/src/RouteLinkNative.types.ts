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

export type NativeErrorCode =
  | 'ERR_TIMEOUT'
  | 'ERR_UNREACHABLE'
  | 'ERR_DNS'
  | 'ERR_TLS_UNTRUSTED'
  | 'ERR_TLS_PIN_MISMATCH'
  | 'ERR_NETWORK'
  | 'ERR_UNSUPPORTED'
  | 'ERR_INVALID_ARGUMENT';
