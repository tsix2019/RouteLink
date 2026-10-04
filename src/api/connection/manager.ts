import type { RouterProfile } from '@/state/routers';

import { nativeHttpClient } from '../http/native';
import type { HttpClient } from '../http/types';
import type { Session } from '../ubus/login';
import { DemoConnection } from './demo/connection';
import { LiveConnection } from './live';

const live = new Map<string, { connection: LiveConnection; key: string }>();
let demo: DemoConnection | null = null;

/** One demo router per app session; its edits are lost on restart (design §16). */
export function getDemoConnection(): DemoConnection {
  return (demo ??= new DemoConnection());
}

export function resetDemoConnection(): void {
  demo = null;
}

/**
 * Cached per router; a new connection (and login) is made when the address, user, pinned
 * certificate or password changes.
 */
export function getLiveConnection(
  profile: RouterProfile,
  password: string,
  onLogin?: (session: Session) => void,
  http: HttpClient = nativeHttpClient,
): LiveConnection {
  const key = [profile.baseUrl, profile.username, profile.tlsSha256 ?? '', password].join('\u0000');
  const cached = live.get(profile.id);
  if (cached && cached.key === key) return cached.connection;
  const connection = new LiveConnection({
    routerId: profile.id,
    baseUrl: profile.baseUrl,
    username: profile.username,
    password,
    authMode: profile.authMode,
    tlsSha256: profile.tlsSha256,
    http,
    onLogin,
  });
  live.set(profile.id, { connection, key });
  return connection;
}

export function dropLiveConnection(routerId: string): void {
  live.delete(routerId);
}
