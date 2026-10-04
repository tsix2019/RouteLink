import type { CertificateInfo, HttpRequestOptions, HttpResponse, NetworkInfo } from 'routelink-native';

/** The native surface under test (RouteLinkNative in the app, a fake in unit tests). */
export interface NativeApi {
  httpRequest(options: HttpRequestOptions): Promise<HttpResponse>;
  fetchServerCertificate(url: string, timeoutMs?: number): Promise<CertificateInfo>;
  getNetworkInfo(): Promise<NetworkInfo>;
  sendWakeOnLan(mac: string): Promise<void>;
}

export interface SelfTestParams {
  /** Plain HTTP test server, e.g. http://127.0.0.1:8098 (serves /, /redirect, /cookie, /echo-cookie). */
  http: string;
  /** Self-signed HTTPS server, e.g. https://127.0.0.1:8443. */
  https: string;
  /** SHA-256 of that server's certificate, lower-case hex. */
  fp: string;
  platform: 'ios' | 'android';
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const codeOf = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? '');

async function expectCode(promise: Promise<unknown>, code: string): Promise<string | undefined> {
  try {
    await promise;
    return `resolved, expected ${code}`;
  } catch (error) {
    return codeOf(error) === code ? undefined : `got ${codeOf(error) || String(error)}, expected ${code}`;
  }
}

/**
 * Native networking checks the CI runs on a real simulator (plan T58): redirects and cookies are
 * never handled for us, TLS modes behave, and the platform-specific APIs answer as documented.
 */
export async function runSelfTest(api: NativeApi, p: SelfTestParams): Promise<CheckResult[]> {
  const wrongFp = p.fp.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const checks: [string, () => Promise<string | undefined>][] = [
    [
      'http-get',
      async () => {
        const r = await api.httpRequest({ url: `${p.http}/`, method: 'GET' });
        return r.status === 200 ? undefined : `status ${r.status}`;
      },
    ],
    [
      'https-system-untrusted',
      () =>
        expectCode(
          api.httpRequest({ url: `${p.https}/`, method: 'GET', tls: { mode: 'system' } }),
          'ERR_TLS_UNTRUSTED',
        ),
    ],
    [
      'cert-fetch',
      async () => {
        const c = await api.fetchServerCertificate(p.https);
        return c.sha256.toLowerCase() === p.fp.toLowerCase() ? undefined : `sha256 ${c.sha256}`;
      },
    ],
    [
      'https-pinned-ok',
      async () => {
        const r = await api.httpRequest({ url: `${p.https}/`, method: 'GET', tls: { mode: 'pinned', sha256: p.fp } });
        return r.status === 200 ? undefined : `status ${r.status}`;
      },
    ],
    [
      'https-pinned-mismatch',
      () =>
        expectCode(
          api.httpRequest({ url: `${p.https}/`, method: 'GET', tls: { mode: 'pinned', sha256: wrongFp } }),
          'ERR_TLS_PIN_MISMATCH',
        ),
    ],
    [
      'no-redirect',
      async () => {
        const r = await api.httpRequest({ url: `${p.http}/redirect`, method: 'GET' });
        return r.status === 302 ? undefined : `status ${r.status}`;
      },
    ],
    [
      'no-cookie-jar',
      async () => {
        await api.httpRequest({ url: `${p.http}/cookie`, method: 'GET' });
        const r = await api.httpRequest({ url: `${p.http}/echo-cookie`, method: 'GET' });
        return r.body.trim() === '' ? undefined : `sent Cookie: ${r.body.trim()}`;
      },
    ],
    [
      'netinfo-shape',
      async () => {
        const info = await api.getNetworkInfo();
        const keys = ['isWifi', 'ip', 'netmask', 'gateway', 'ifname'];
        const missing = keys.filter((k) => !(k in info));
        return missing.length ? `missing ${missing.join(', ')}` : undefined;
      },
    ],
  ];
  if (p.platform === 'ios') {
    checks.push(['wol-unsupported', () => expectCode(api.sendWakeOnLan('00:11:22:33:44:55'), 'ERR_UNSUPPORTED')]);
  }

  const results: CheckResult[] = [];
  for (const [name, check] of checks) {
    try {
      const problem = await check();
      results.push({ name, passed: !problem, detail: problem });
    } catch (error) {
      results.push({ name, passed: false, detail: `${codeOf(error)} ${String(error)}`.trim() });
    }
  }
  return results;
}
