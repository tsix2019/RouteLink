import { LiveConnection } from '@/api/connection/live';
import { classifyError, type ConnectionFailure } from '@/api/connection/types';
import { nativeHttpClient } from '@/api/http/native';
import type { HttpClient } from '@/api/http/types';
import type { AuthMode } from '@/api/ubus/login';
import { normalizeBaseUrl } from '@/utils/url';

export interface LoginAttempt {
  baseUrl: string;
  username: string;
  password: string;
  /** Pinned certificate for HTTPS routers with a self-signed certificate. */
  tlsSha256?: string;
}

export type LoginOutcome =
  { ok: true; authMode: AuthMode; model?: string; hostname?: string } | { ok: false; failure: ConnectionFailure };

interface Board {
  model?: string;
  hostname?: string;
}

/**
 * Logs in once and reads the board info, without saving anything: used before a router is added
 * so that a wrong password or an untrusted certificate is reported next to the router.
 */
export async function tryLogin(attempt: LoginAttempt, http: HttpClient = nativeHttpClient): Promise<LoginOutcome> {
  let authMode: AuthMode | undefined;
  try {
    const connection = new LiveConnection({
      routerId: 'login-check',
      baseUrl: attempt.baseUrl,
      username: attempt.username,
      password: attempt.password,
      tlsSha256: attempt.tlsSha256,
      http,
      onLogin: (session) => {
        authMode = session.mode;
      },
    });
    const board = await connection.call<Board>('system', 'board');
    return { ok: true, authMode: authMode ?? 'ubus', model: board.model, hostname: board.hostname };
  } catch (error) {
    return { ok: false, failure: classifyError(error) };
  }
}

/** "https://192.168.1.1:8443" → "192.168.1.1". */
export function hostOf(baseUrl: string): string {
  return baseUrl
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/:\d+$/, '')
    .replace(/^\[(.*)\]$/, '$1');
}

/** Address typed by the user → base URL, or null when it cannot be one. */
export function parseAddress(input: string): string | null {
  try {
    return normalizeBaseUrl(input);
  } catch {
    return null;
  }
}
