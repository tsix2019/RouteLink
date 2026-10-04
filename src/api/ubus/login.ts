import type { HttpClient, TlsOptions } from '../http/types';
import { AuthError, ProtocolError } from './errors';
import { decodeCallResponse, encodeCall, parseJson } from './jsonrpc';
import { NULL_SESSION } from './types';

export type AuthMode = 'ubus' | 'luci';

export interface Credentials {
  username: string;
  password: string;
}

export interface Session {
  mode: AuthMode;
  /** URL that accepts JSON-RPC ubus calls for this session. */
  endpoint: string;
  sid: string;
  /** LuCI mode only: the sysauth cookie to send with every call. */
  cookie?: string;
  expiresInSec: number;
}

export interface LoginTarget {
  http: HttpClient;
  /** e.g. "http://192.168.1.1" — no trailing slash. */
  baseUrl: string;
  tls?: TlsOptions;
}

const LOGIN_TIMEOUT_MS = 8_000;

/** `session login` on uhttpd's /ubus endpoint (uhttpd-mod-ubus). */
export async function loginUbus(t: LoginTarget, cred: Credentials): Promise<Session> {
  const endpoint = `${t.baseUrl}/ubus`;
  const res = await t.http.request({
    url: endpoint,
    method: 'POST',
    tls: t.tls,
    timeoutMs: LOGIN_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      encodeCall(1, NULL_SESSION, {
        object: 'session',
        method: 'login',
        params: { username: cred.username, password: cred.password },
      }),
    ),
  });
  if (res.status === 404) throw new AuthError('NO_ENDPOINT');
  if (res.status !== 200) throw new ProtocolError(res.status, `HTTP ${res.status} from ${endpoint}`);

  let body: unknown;
  try {
    body = parseJson(res.body);
  } catch {
    throw new AuthError('NO_ENDPOINT'); // an HTML page: no ubus here
  }
  const r = decodeCallResponse<{ ubus_rpc_session: string; expires?: number }>(body, 'session.login');
  if (!r.ok) {
    if (r.error.code === 'PERMISSION_DENIED' || r.error.code === 'ACCESS_DENIED')
      throw new AuthError('BAD_CREDENTIALS');
    throw r.error;
  }
  return { mode: 'ubus', endpoint, sid: r.data.ubus_rpc_session, expiresInSec: r.data.expires ?? 300 };
}

/** LuCI form login; the sysauth cookie value doubles as the ubus session id for /cgi-bin/luci/admin/ubus. */
export async function loginLuci(t: LoginTarget, cred: Credentials): Promise<Session> {
  const res = await t.http.request({
    url: `${t.baseUrl}/cgi-bin/luci/`,
    method: 'POST',
    tls: t.tls,
    timeoutMs: LOGIN_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `luci_username=${encodeURIComponent(cred.username)}&luci_password=${encodeURIComponent(cred.password)}`,
  });
  if (res.status === 404) throw new AuthError('NO_ENDPOINT');
  const cookie = findSysauth(res.headers['set-cookie'] ?? []);
  if (cookie && (res.status === 302 || res.status === 200)) {
    return {
      mode: 'luci',
      endpoint: `${t.baseUrl}/cgi-bin/luci/admin/ubus`,
      sid: cookie.value,
      cookie: `${cookie.name}=${cookie.value}`,
      expiresInSec: 3600,
    };
  }
  if (res.status === 403 || res.status === 200) throw new AuthError('BAD_CREDENTIALS');
  throw new ProtocolError(res.status, `HTTP ${res.status} from LuCI login`);
}

export function findSysauth(cookies: string[]): { name: string; value: string } | null {
  for (const line of cookies) {
    const m = /^\s*(sysauth(?:_https?)?)=([^;]*)/.exec(line);
    if (m && m[2] && m[2] !== 'deleted') return { name: m[1], value: m[2] };
  }
  return null;
}

/** Tries the preferred mode first and falls back only when an endpoint does not exist. */
export async function login(t: LoginTarget, cred: Credentials, preferred?: AuthMode): Promise<Session> {
  const order: AuthMode[] = preferred === 'luci' ? ['luci', 'ubus'] : ['ubus', 'luci'];
  let last: unknown = new AuthError('NO_ENDPOINT');
  for (const mode of order) {
    try {
      return mode === 'ubus' ? await loginUbus(t, cred) : await loginLuci(t, cred);
    } catch (e) {
      if (e instanceof AuthError && e.code === 'NO_ENDPOINT') {
        last = e;
        continue;
      }
      throw e;
    }
  }
  throw last;
}
