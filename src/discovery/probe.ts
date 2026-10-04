import { NativeError } from '@/api/http/errors';
import type { HttpClient, HttpResponse } from '@/api/http/types';

import type { ProbeHit, Prober } from './scan';

const TIMEOUT_MS = 1_200;

/** "OpenWrt - LuCI" → "OpenWrt"; LuCI puts the router's host name in the login page title. */
export function hostnameFromTitle(html: string): string | undefined {
  const m = /<title>\s*([^<]*?)\s*-\s*LuCI\s*<\/title>/i.exec(html);
  return m?.[1] || undefined;
}

export const looksLikeLuci = (res: HttpResponse) => res.status === 200 && /luci/i.test(res.body);

function looksLikeUbus(res: HttpResponse): boolean {
  if (res.status !== 200) return false;
  try {
    return (JSON.parse(res.body) as { jsonrpc?: unknown }).jsonrpc === '2.0';
  } catch {
    return false;
  }
}

const UBUS_PROBE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'list',
  params: ['00000000000000000000000000000000', 'session'],
});

/**
 * Identifies OpenWrt by its LuCI page or ubus endpoint. Requests carry no credentials; HTTPS uses
 * the insecure-probe TLS mode because routers typically present self-signed certificates.
 */
export function createProber(http: HttpClient): Prober {
  const get = (url: string, https: boolean) =>
    http.request({ url, method: 'GET', timeoutMs: TIMEOUT_MS, tls: https ? { mode: 'insecure-probe' } : undefined });

  return {
    async probe(host: string, signal: AbortSignal): Promise<ProbeHit | null> {
      let tryHttps = false;
      try {
        const res = await get(`http://${host}/cgi-bin/luci/`, false);
        if (looksLikeLuci(res)) return { scheme: 'http', hostname: hostnameFromTitle(res.body) };
        const location = res.headers.location?.[0] ?? '';
        if (res.status >= 300 && res.status < 400 && location.startsWith('https://')) tryHttps = true;
        else {
          const ubus = await http.request({
            url: `http://${host}/ubus`,
            method: 'POST',
            timeoutMs: TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
            body: UBUS_PROBE,
          });
          if (looksLikeUbus(ubus)) return { scheme: 'http' };
        }
      } catch (error) {
        // Port 80 refused: maybe HTTPS only. A timeout means the host is most likely not there.
        if (error instanceof NativeError && error.code === 'ERR_UNREACHABLE') tryHttps = true;
        else return null;
      }
      if (!tryHttps || signal.aborted) return null;
      try {
        const res = await get(`https://${host}/cgi-bin/luci/`, true);
        return looksLikeLuci(res) ? { scheme: 'https', hostname: hostnameFromTitle(res.body) } : null;
      } catch {
        return null;
      }
    },
  };
}
