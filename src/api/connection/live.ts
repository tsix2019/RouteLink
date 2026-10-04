import { normalizeBaseUrl } from '@/utils/url';

import { NativeError } from '../http/errors';
import type { HttpClient, TlsOptions } from '../http/types';
import type { AuthMode, Session } from '../ubus/login';
import { UbusSession, type CallOptions } from '../ubus/session';
import type { UbusCall, UbusResult } from '../ubus/types';
import type { RouterConnection } from './types';

export interface LiveConnectionConfig {
  routerId: string;
  baseUrl: string;
  username: string;
  password: string;
  authMode?: AuthMode;
  /** Pinned certificate fingerprint (lower-case hex). Without it, the system trust store decides. */
  tlsSha256?: string;
  /** nativeHttpClient in the app, nodeHttpClient in scripts and integration tests. */
  http: HttpClient;
  onLogin?: (session: Session) => void;
}

/** Any HTTP answer (even 404) or TLS handshake means the router is up. No credentials are sent. */
export async function pingRouter(
  http: HttpClient,
  baseUrl: string,
  tls: TlsOptions = { mode: 'system' },
): Promise<boolean> {
  try {
    await http.request({ url: `${baseUrl}/`, method: 'GET', timeoutMs: 1_500, tls });
    return true;
  } catch (error) {
    return !(error instanceof NativeError && error.isConnectivity());
  }
}

export class LiveConnection implements RouterConnection {
  readonly kind = 'live' as const;
  readonly routerId: string;
  readonly baseUrl: string;
  readonly tls: TlsOptions;
  private readonly session: UbusSession;

  constructor(private readonly cfg: LiveConnectionConfig) {
    this.routerId = cfg.routerId;
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.tls = cfg.tlsSha256 ? { mode: 'pinned', sha256: cfg.tlsSha256 } : { mode: 'system' };
    this.session = new UbusSession(
      { http: cfg.http, baseUrl: this.baseUrl, tls: this.tls },
      { username: cfg.username, password: cfg.password },
      { preferredMode: cfg.authMode, onLogin: cfg.onLogin },
    );
  }

  call<T>(object: string, method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T> {
    return this.session.call<T>(object, method, params, options);
  }

  batch(calls: UbusCall[], options?: CallOptions): Promise<UbusResult[]> {
    return this.session.batch(calls, options);
  }

  ping(): Promise<boolean> {
    return pingRouter(this.cfg.http, this.baseUrl, this.tls);
  }
}
