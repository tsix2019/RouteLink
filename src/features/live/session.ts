import type { LiveMonitorSession } from 'routelink-native';

import { nativeHttpClient } from '@/api/http/native';
import type { HttpClient } from '@/api/http/types';
import { login } from '@/api/ubus/login';
import type { RouterProfile } from '@/state/routers';
import { normalizeBaseUrl } from '@/utils/url';

/**
 * A session of its own for the live monitor's native polling (plan P4 §0.8): the service keeps it alive
 * by polling (rpcd renews a session on every call) and never sees the password. Logging in again
 * after the router dropped it is the app's job (onLiveMonitorStatus "session-expired").
 */
export async function liveSession(
  profile: Pick<RouterProfile, 'baseUrl' | 'username' | 'authMode' | 'tlsSha256'>,
  password: string,
  http: HttpClient = nativeHttpClient,
): Promise<LiveMonitorSession> {
  const tls = profile.tlsSha256 ? { mode: 'pinned' as const, sha256: profile.tlsSha256 } : { mode: 'system' as const };
  const session = await login(
    { http, baseUrl: normalizeBaseUrl(profile.baseUrl), tls },
    { username: profile.username, password },
    profile.authMode,
  );
  return session.cookie
    ? { endpoint: session.endpoint, sid: session.sid, cookie: session.cookie }
    : { endpoint: session.endpoint, sid: session.sid };
}
