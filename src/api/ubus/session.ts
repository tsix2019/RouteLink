import { ProtocolError, UbusError } from './errors';
import { decodeCallResponse, encodeCall, parseJson } from './jsonrpc';
import { login, type AuthMode, type Credentials, type LoginTarget, type Session } from './login';
import { callKey, type UbusCall, type UbusResult } from './types';

export interface CallOptions {
  /** Default true. `false` keeps the current session even if it was rejected (needed by `uci confirm`). */
  relogin?: boolean;
  timeoutMs?: number;
}

export interface SessionOptions {
  preferredMode?: AuthMode;
  onLogin?: (session: Session) => void;
  timeoutMs?: number;
}

/**
 * A logged-in ubus session that re-authenticates transparently.
 * An ACCESS_DENIED that survives a fresh login is an ACL denial and becomes PERMISSION_DENIED.
 */
export class UbusSession {
  private session: Session | null = null;
  private inflight: Promise<Session> | null = null;
  private nextId = 1;
  private readonly denied = new Set<string>();

  constructor(
    private readonly target: LoginTarget,
    private readonly cred: Credentials,
    private readonly opts: SessionOptions = {},
  ) {}

  get current(): Session | null {
    return this.session;
  }

  /** The logged-in session, logging in first if needed (for endpoints outside JSON-RPC, such as cgi-io). */
  ensureSession(): Promise<Session> {
    return this.session ? Promise.resolve(this.session) : this.relogin(null);
  }

  /** A fresh login replacing `stale`, which the router no longer accepts. */
  renewSession(stale: Session): Promise<Session> {
    return this.relogin(stale);
  }

  async call<T>(object: string, method: string, params?: Record<string, unknown>, o: CallOptions = {}): Promise<T> {
    const [result] = await this.batch([{ object, method, params }], o);
    if (!result.ok) throw result.error;
    return result.data as T;
  }

  async batch(calls: UbusCall[], o: CallOptions = {}): Promise<UbusResult[]> {
    if (calls.length === 0) return [];
    const s = this.session ?? (await this.relogin(null));
    const results = await this.send(s, calls, o.timeoutMs);
    if (o.relogin === false) return results;

    const retry = results.flatMap((r, i) =>
      !r.ok && r.error.code === 'ACCESS_DENIED' && !this.denied.has(callKey(calls[i])) ? [i] : [],
    );
    if (retry.length > 0) {
      const fresh = await this.relogin(s);
      const again = await this.send(
        fresh,
        retry.map((i) => calls[i]),
        o.timeoutMs,
      );
      retry.forEach((i, j) => {
        results[i] = again[j];
      });
    }
    return this.markDenied(calls, results);
  }

  private markDenied(calls: UbusCall[], results: UbusResult[]): UbusResult[] {
    return results.map((r, i) => {
      if (r.ok || r.error.code !== 'ACCESS_DENIED') return r;
      const key = callKey(calls[i]);
      this.denied.add(key);
      return { ok: false, error: new UbusError('PERMISSION_DENIED', key, 'access denied') };
    });
  }

  private relogin(stale: Session | null): Promise<Session> {
    if (this.session && this.session !== stale) return Promise.resolve(this.session);
    this.inflight ??= login(this.target, this.cred, this.session?.mode ?? this.opts.preferredMode)
      .then((s) => {
        this.session = s;
        this.denied.clear();
        this.opts.onLogin?.(s);
        return s;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async send(s: Session, calls: UbusCall[], timeoutMs?: number): Promise<UbusResult[]> {
    const ids = calls.map(() => this.nextId++);
    const payload =
      calls.length === 1 ? encodeCall(ids[0], s.sid, calls[0]) : calls.map((c, i) => encodeCall(ids[i], s.sid, c));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.cookie) headers.Cookie = s.cookie;

    const res = await this.target.http.request({
      url: s.endpoint,
      method: 'POST',
      headers,
      tls: this.target.tls,
      body: JSON.stringify(payload),
      timeoutMs: timeoutMs ?? this.opts.timeoutMs ?? 8_000,
    });
    if (res.status === 401 || res.status === 403) {
      return calls.map((c) => ({ ok: false, error: new UbusError('ACCESS_DENIED', callKey(c), `HTTP ${res.status}`) }));
    }
    if (res.status !== 200) throw new ProtocolError(res.status, `HTTP ${res.status} from ${s.endpoint}`);

    const body = parseJson(res.body);
    const replies = (Array.isArray(body) ? body : [body]) as ({ id?: number | null } | null)[];
    const byId = new Map(replies.filter((r) => r?.id != null).map((r) => [r!.id, r]));
    return calls.map((c, i) => {
      // Some uhttpd builds (seen on Kwrt) answer errors with "id": null; they keep the request order.
      const positional = replies[i] && replies[i]!.id == null ? replies[i] : undefined;
      const reply = byId.get(ids[i]) ?? positional;
      return reply
        ? decodeCallResponse(reply, callKey(c))
        : { ok: false as const, error: new UbusError('UNKNOWN', callKey(c), 'missing response') };
    });
  }
}
