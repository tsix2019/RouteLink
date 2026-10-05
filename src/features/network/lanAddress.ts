import { hostOf } from '@/features/routers/login';

/**
 * Where to confirm a LAN address change, and whether the saved router address follows it: only when the
 * app reaches the router at its old LAN address (a host name keeps working once DNS catches up).
 */
export function movedBaseUrl(baseUrl: string, oldIp: string, newIp: string): { confirmAt: string; updateProfile: boolean } {
  const host = hostOf(baseUrl);
  const scheme = /^https:/i.test(baseUrl) ? 'https' : 'http';
  const port = /:(\d+)$/.exec(baseUrl.replace(/\/+$/, ''))?.[1];
  const confirmAt = `${scheme}://${newIp}${port ? `:${port}` : ''}`;
  return { confirmAt, updateProfile: host === oldIp };
}
