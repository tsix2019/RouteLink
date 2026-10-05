import { normalizeBaseUrl } from '@/utils/url';

import { NativeError } from '../http/errors';
import type { HttpClient, TlsOptions } from '../http/types';
import { ProtocolError, UbusError } from '../ubus/errors';
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

/** Package installs download dependencies on the router; give them time. */
const CGI_EXEC_TIMEOUT_MS = 180_000;
const BACKSLASH = String.fromCharCode(92);

/** cgi-io splits the command line at unescaped whitespace: escape it (and backslashes) like LuCI's fs.exec_direct. */
export function cgiCommand(argv: string[]): string {
  return argv
    .map((a) =>
      a
        .split(BACKSLASH)
        .join(BACKSLASH + BACKSLASH)
        .replace(/(\s)/g, `${BACKSLASH}$1`),
    )
    .join(' ');
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

  async cgiExec(argv: string[], options: { timeoutMs?: number } = {}): Promise<string> {
    return this.cgiPost(
      'cgi-exec',
      { command: cgiCommand(argv) },
      `cgi-exec ${argv[0]}`,
      options.timeoutMs ?? CGI_EXEC_TIMEOUT_MS,
    );
  }

  /** A text file through /cgi-bin/cgi-download: LuCI's own way to read files that `file read` refuses. */
  cgiRead(path: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const filename = path.slice(path.lastIndexOf('/') + 1) || 'file';
    return this.cgiPost('cgi-download', { path, filename }, `cgi-download ${path}`, options.timeoutMs ?? 10_000);
  }

  private async cgiPost(endpoint: string, fields: Record<string, string>, label: string, timeoutMs: number) {
    const run = (s: Session) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (s.cookie) headers.Cookie = s.cookie;
      const form = { sessionid: s.sid, ...fields };
      return this.cfg.http.request({
        url: `${this.baseUrl}/cgi-bin/${endpoint}`,
        method: 'POST',
        headers,
        tls: this.tls,
        body: Object.entries(form)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&'),
        timeoutMs,
      });
    };
    const first = await this.session.ensureSession();
    let res = await run(first);
    // cgi-io answers 403 both for an expired session and for an ACL denial; only the first is worth a login.
    if (res.status === 403 && !/ACL/.test(res.body)) res = await run(await this.session.renewSession(first));
    if (res.status === 403) throw new UbusError('PERMISSION_DENIED', label, res.body.trim());
    if (res.status === 404) throw new UbusError('NOT_FOUND', label, res.body.trim());
    if (res.status !== 200) throw new ProtocolError(res.status, `HTTP ${res.status} from ${endpoint}`);
    return res.body;
  }

  /** The same session at another address; the endpoint keeps its path (/ubus or LuCI's). */
  relocated(baseUrl: string): LiveConnection {
    const moved = new LiveConnection({
      ...this.cfg,
      baseUrl,
      authMode: this.session.current?.mode ?? this.cfg.authMode,
      onLogin: undefined,
    });
    const current = this.session.current;
    if (current) {
      moved.session.adopt({ ...current, endpoint: moved.baseUrl + current.endpoint.slice(this.baseUrl.length) });
    }
    return moved;
  }

  /** A second session to the same router; it logs in on first use with the mode that worked here. */
  fork(): LiveConnection {
    return new LiveConnection({
      ...this.cfg,
      authMode: this.session.current?.mode ?? this.cfg.authMode,
      onLogin: undefined,
    });
  }
}
