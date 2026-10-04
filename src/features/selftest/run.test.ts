import type { HttpRequestOptions, HttpResponse } from 'routelink-native';

import { runSelfTest, type NativeApi } from './run';

const FP = 'ab'.repeat(32);
const err = (code: string) => Object.assign(new Error(code), { code });
const res = (status: number, body = ''): HttpResponse => ({ status, headers: {}, body });

/** A well-behaved native module: what the CI expects from the real one. */
function goodApi(): NativeApi {
  let cookieSet = false;
  return {
    async httpRequest(o: HttpRequestOptions) {
      if (o.url.startsWith('https://')) {
        if (!o.tls || o.tls.mode === 'system') throw err('ERR_TLS_UNTRUSTED');
        if (o.tls.mode === 'pinned' && o.tls.sha256 !== FP) throw err('ERR_TLS_PIN_MISMATCH');
        return res(200);
      }
      if (o.url.endsWith('/redirect')) return res(302);
      if (o.url.endsWith('/cookie')) {
        cookieSet = true;
        return res(200);
      }
      if (o.url.endsWith('/echo-cookie')) return res(200, cookieSet ? '' : '');
      return res(200);
    },
    fetchServerCertificate: async () => ({ sha256: FP, subject: '', issuer: '', notBefore: '', notAfter: '' }),
    getNetworkInfo: async () => ({
      isWifi: true,
      ip: '10.0.0.2',
      netmask: '255.255.255.0',
      gateway: '10.0.0.1',
      ifname: 'en0',
    }),
    sendWakeOnLan: async () => {
      throw err('ERR_UNSUPPORTED');
    },
  };
}

const params = { http: 'http://127.0.0.1:8098', https: 'https://127.0.0.1:8443', fp: FP };

it('passes every check against a correct native module', async () => {
  const results = await runSelfTest(goodApi(), { ...params, platform: 'ios' });
  expect(results.filter((r) => !r.passed)).toEqual([]);
  expect(results.map((r) => r.name)).toContain('wol-unsupported');
});

it('skips the iOS-only check on Android', async () => {
  const results = await runSelfTest(goodApi(), { ...params, platform: 'android' });
  expect(results.map((r) => r.name)).not.toContain('wol-unsupported');
});

it('fails when redirects are followed or cookies are replayed', async () => {
  const api = goodApi();
  const base = api.httpRequest;
  api.httpRequest = async (o) =>
    o.url.endsWith('/redirect') ? res(200) : o.url.endsWith('/echo-cookie') ? res(200, 'sid=1') : base(o);
  const failed = (await runSelfTest(api, { ...params, platform: 'android' })).filter((r) => !r.passed);
  expect(failed.map((r) => r.name)).toEqual(['no-redirect', 'no-cookie-jar']);
});

it('fails when an untrusted certificate is accepted', async () => {
  const api = goodApi();
  const base = api.httpRequest;
  api.httpRequest = async (o) => (o.url.startsWith('https://') ? res(200) : base(o));
  const failed = (await runSelfTest(api, { ...params, platform: 'android' })).filter((r) => !r.passed);
  expect(failed.map((r) => r.name)).toEqual(['https-system-untrusted', 'https-pinned-mismatch']);
});
