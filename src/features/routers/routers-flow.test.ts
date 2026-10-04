import { act, renderHook, waitFor } from '@testing-library/react-native';

import { NativeError } from '@/api/http/errors';
import { FakeHttpClient, ubusEndpoint } from '@/api/http/fake';
import type { ProbeHit, Prober } from '@/discovery/scan';

import { hostOf, parseAddress, tryLogin } from './login';
import { formatFingerprint, resolveCertificate, type TrustRequest } from './trust';
import { looksLikeSideRouter, useDiscovery, type DiscoveryDeps } from './useDiscovery';

const certificate = {
  sha256: 'AB'.repeat(32),
  subject: 'CN=OpenWrt',
  issuer: 'CN=OpenWrt',
  notBefore: '',
  notAfter: '',
};

describe('tryLogin', () => {
  const router = ubusEndpoint({
    'session.login': (params) => (params.password === 'right' ? [0, { ubus_rpc_session: 'S', expires: 300 }] : [6]),
    'system.board': () => [0, { model: 'OpenWrt One', hostname: 'gw' }],
  });

  it('returns the board info and login mode', async () => {
    const http = new FakeHttpClient().on('POST http://192.168.1.1/ubus', router);
    await expect(
      tryLogin({ baseUrl: 'http://192.168.1.1', username: 'root', password: 'right' }, http),
    ).resolves.toEqual({ ok: true, authMode: 'ubus', model: 'OpenWrt One', hostname: 'gw' });
  });

  it('reports a wrong password', async () => {
    const http = new FakeHttpClient()
      .on('POST http://192.168.1.1/ubus', router)
      .on('GET http://192.168.1.1/cgi-bin/luci/', { status: 403, headers: {}, body: '' })
      .on('POST http://192.168.1.1/cgi-bin/luci/', { status: 403, headers: {}, body: '' });
    const outcome = await tryLogin({ baseUrl: 'http://192.168.1.1', username: 'root', password: 'wrong' }, http);
    expect(outcome).toEqual({ ok: false, failure: { kind: 'auth' } });
  });

  it('reports an untrusted certificate', async () => {
    const http = new FakeHttpClient().on(() => true, new NativeError('ERR_TLS_UNTRUSTED', 'self-signed'));
    const outcome = await tryLogin({ baseUrl: 'https://r', username: 'root', password: 'x' }, http);
    expect(outcome).toEqual({ ok: false, failure: { kind: 'tls-untrusted' } });
  });

  it('parses addresses and hosts', () => {
    expect(parseAddress('192.168.1.1')).toBe('http://192.168.1.1');
    expect(parseAddress(' https://OpenWrt.lan:8443/cgi-bin ')).toBe('https://openwrt.lan:8443');
    expect(parseAddress('ftp://x')).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(hostOf('https://192.168.1.1:8443')).toBe('192.168.1.1');
    expect(hostOf('http://[fd00::1]:80')).toBe('fd00::1');
  });
});

describe('resolveCertificate', () => {
  const deps = (answer: boolean) => {
    const asked: TrustRequest[] = [];
    return {
      asked,
      fetchCertificate: jest.fn(async () => certificate),
      ask: jest.fn(async (r: TrustRequest) => {
        asked.push(r);
        return answer;
      }),
    };
  };

  it('asks to trust a new certificate and returns its fingerprint', async () => {
    const d = deps(true);
    await expect(resolveCertificate({ baseUrl: 'https://r', failure: 'tls-untrusted' }, d)).resolves.toBe(
      'ab'.repeat(32),
    );
    expect(d.asked[0].kind).toBe('new');
  });

  it('shows the old fingerprint when the certificate changed', async () => {
    const d = deps(true);
    await resolveCertificate({ baseUrl: 'https://r', failure: 'tls-mismatch', pinnedSha256: 'cd'.repeat(32) }, d);
    expect(d.asked[0]).toMatchObject({ kind: 'changed', previousSha256: 'cd'.repeat(32) });
  });

  it('returns null when the user declines', async () => {
    await expect(resolveCertificate({ baseUrl: 'https://r', failure: 'tls-untrusted' }, deps(false))).resolves.toBe(
      null,
    );
  });

  it('formats fingerprints in upper-case pairs', () => {
    expect(formatFingerprint('ab01cd')).toBe('AB:01:CD');
  });
});

describe('useDiscovery', () => {
  const wifi = { isWifi: true, ip: '192.168.1.23', netmask: '255.255.255.0', gateway: '192.168.1.1', ifname: 'wlan0' };

  function prober(hits: Record<string, ProbeHit>, gate?: Promise<void>): Prober {
    return {
      async probe(host) {
        if (gate) await gate;
        return hits[host] ?? null;
      },
    };
  }

  it('scans the Wi-Fi subnet on mount and merges host names into IP results', async () => {
    const deps: DiscoveryDeps = {
      getNetworkInfo: async () => wifi,
      prober: prober({
        '192.168.1.1': { scheme: 'http', hostname: 'gw' },
        'openwrt.lan': { scheme: 'http', hostname: 'gw' },
        '192.168.1.2': { scheme: 'https', hostname: 'ap' },
      }),
    };
    const { result } = await renderHook(() => useDiscovery(deps));
    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(result.current.found.map((r) => [r.address, r.isGateway, r.aliases])).toEqual([
      ['192.168.1.1', true, ['openwrt.lan']],
      ['192.168.1.2', false, []],
    ]);
    expect(result.current.done).toBe(result.current.total);
    expect(looksLikeSideRouter(result.current)).toBe(false);
  });

  it('asks for Wi-Fi when the phone is not on Wi-Fi', async () => {
    const deps: DiscoveryDeps = {
      getNetworkInfo: async () => ({ ...wifi, isWifi: false }),
      prober: prober({}),
    };
    const { result } = await renderHook(() => useDiscovery(deps));
    await waitFor(() => expect(result.current.phase).toBe('no-wifi'));
  });

  it('stops reporting results after cancel', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps: DiscoveryDeps = {
      getNetworkInfo: async () => wifi,
      prober: prober({ '192.168.1.5': { scheme: 'http' } }, gate),
    };
    const { result } = await renderHook(() => useDiscovery(deps));
    await waitFor(() => expect(result.current.phase).toBe('scanning'));
    await act(async () => {
      result.current.cancel();
      release();
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.found).toEqual([]);
  });

  it('scans a typed CIDR instead of the subnet and flags a side router', async () => {
    const deps: DiscoveryDeps = {
      getNetworkInfo: async () => wifi,
      prober: prober({ '10.0.0.2': { scheme: 'http' }, '192.168.1.3': { scheme: 'http' } }),
    };
    const { result } = await renderHook(() => useDiscovery(deps));
    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(looksLikeSideRouter(result.current)).toBe(true);
    await act(async () => result.current.start('10.0.0.0/30'));
    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(result.current.found.map((r) => r.address)).toEqual(['10.0.0.2']);
    expect(result.current.total).toBe(2 + 2); // 2 hosts + openwrt.lan + openwrt
    expect(looksLikeSideRouter(result.current)).toBe(false);
  });
});
