import { NativeError } from '@/api/http/errors';
import { FakeHttpClient, json } from '@/api/http/fake';

import { createProber, hostnameFromTitle } from './probe';
import { scan, sortRouters, type ProbeHit, type Prober } from './scan';

function fakeProber(hits: Record<string, ProbeHit>, delayMs = 0): Prober & { inFlight: number; maxInFlight: number } {
  const p = {
    inFlight: 0,
    maxInFlight: 0,
    async probe(host: string) {
      p.inFlight += 1;
      p.maxInFlight = Math.max(p.maxInFlight, p.inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      p.inFlight -= 1;
      return hits[host] ?? null;
    },
  };
  return p;
}

const targets = Array.from({ length: 30 }, (_, i) => `192.168.1.${i + 1}`);

describe('scan', () => {
  it('finds routers, gateway first, and reports progress to completion', async () => {
    const onFound = jest.fn();
    const onProgress = jest.fn();
    const result = await scan({
      targets,
      hostnames: [],
      gateway: '192.168.1.1',
      prober: fakeProber({
        '192.168.1.2': { scheme: 'http', hostname: 'SideRouter' },
        '192.168.1.1': { scheme: 'https' },
      }),
      signal: new AbortController().signal,
      onFound,
      onProgress,
    });
    expect(result.map((r) => [r.address, r.isGateway, r.scheme])).toEqual([
      ['192.168.1.1', true, 'https'],
      ['192.168.1.2', false, 'http'],
    ]);
    expect(onFound).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(30, 30);
  });

  it('probes the gateway, host names and .1/.254 before sweeping the rest', async () => {
    const order: string[] = [];
    const prober: Prober = {
      async probe(host) {
        order.push(host);
        await new Promise((r) => setTimeout(r, 1));
        return null;
      },
    };
    const list = Array.from({ length: 254 }, (_, i) => `10.0.0.${i + 1}`);
    await scan({ targets: list, gateway: '10.0.0.77', prober, signal: new AbortController().signal });
    expect(order.slice(0, 5).sort()).toEqual(['10.0.0.1', '10.0.0.254', '10.0.0.77', 'openwrt', 'openwrt.lan']);
    expect(order).toHaveLength(256);
  });

  it('respects the concurrency limit', async () => {
    const prober = fakeProber({}, 5);
    await scan({ targets, hostnames: [], prober, concurrency: 4, signal: new AbortController().signal });
    expect(prober.maxInFlight).toBe(4);
  });

  it('merges a host name with the IP of the same router', async () => {
    const result = await scan({
      targets: ['192.168.1.1'],
      hostnames: ['openwrt.lan'],
      prober: fakeProber({
        'openwrt.lan': { scheme: 'http', hostname: 'OpenWrt' },
        '192.168.1.1': { scheme: 'http', hostname: 'OpenWrt' },
      }),
      signal: new AbortController().signal,
    });
    expect(result).toEqual([
      { address: '192.168.1.1', scheme: 'http', hostname: 'OpenWrt', isGateway: false, aliases: ['openwrt.lan'] },
    ]);
  });

  it('stops reporting after cancellation', async () => {
    const controller = new AbortController();
    const onFound = jest.fn();
    const promise = scan({
      targets,
      hostnames: [],
      prober: fakeProber(Object.fromEntries(targets.map((t) => [t, { scheme: 'http' as const }])), 5),
      concurrency: 2,
      signal: controller.signal,
      onFound,
    });
    await new Promise((r) => setTimeout(r, 12));
    controller.abort();
    await promise;
    expect(onFound.mock.calls.length).toBeLessThan(10);
  });

  it('sorts gateway, then IPs numerically, then names', () => {
    const r = (address: string, isGateway = false) => ({ address, scheme: 'http' as const, isGateway, aliases: [] });
    expect(
      sortRouters([r('openwrt.lan'), r('192.168.1.10'), r('192.168.1.9'), r('192.168.1.200', true)]).map(
        (x) => x.address,
      ),
    ).toEqual(['192.168.1.200', '192.168.1.9', '192.168.1.10', 'openwrt.lan']);
  });
});

describe('createProber', () => {
  const signal = new AbortController().signal;

  it('recognises LuCI over HTTP and reads the host name', async () => {
    const http = new FakeHttpClient().on('GET http://10.0.0.1/cgi-bin/luci/', {
      status: 200,
      headers: {},
      body: '<html><head><title>Living-Room - LuCI</title></head></html>',
    });
    await expect(createProber(http).probe('10.0.0.1', signal)).resolves.toEqual({
      scheme: 'http',
      hostname: 'Living-Room',
    });
  });

  it('reads the host name from the 403 login page of current LuCI', async () => {
    const http = new FakeHttpClient().on('GET http://10.0.0.1/cgi-bin/luci/', {
      status: 403,
      headers: {},
      body: '<html><head><title>gw - LuCI</title></head></html>',
    });
    await expect(createProber(http).probe('10.0.0.1', signal)).resolves.toEqual({ scheme: 'http', hostname: 'gw' });
  });

  it('follows a redirect to HTTPS with the insecure probe mode', async () => {
    const http = new FakeHttpClient()
      .on('GET http://10.0.0.1/cgi-bin/luci/', {
        status: 302,
        headers: { location: ['https://10.0.0.1/cgi-bin/luci/'] },
        body: '',
      })
      .on('GET https://10.0.0.1/cgi-bin/luci/', { status: 200, headers: {}, body: '<title>OpenWrt - LuCI</title>' });
    await expect(createProber(http).probe('10.0.0.1', signal)).resolves.toEqual({
      scheme: 'https',
      hostname: 'OpenWrt',
    });
    expect(http.requests[1].tls).toEqual({ mode: 'insecure-probe' });
    expect(http.requests.every((r) => !r.body?.includes('password'))).toBe(true);
  });

  it('rejects vendor firmware that merely mentions luci', async () => {
    const http = new FakeHttpClient()
      .on('GET http://10.0.0.5/cgi-bin/luci/', {
        status: 200,
        headers: {},
        body: '<title>Vendor Router</title><meta http-equiv="refresh" content="0; url=/cgi-bin/luci/web" />',
      })
      .on('POST http://10.0.0.5/ubus', { status: 404, headers: {}, body: '' });
    await expect(createProber(http).probe('10.0.0.5', signal)).resolves.toBeNull();
  });

  it('accepts a bare ubus endpoint without LuCI', async () => {
    const http = new FakeHttpClient()
      .on('GET http://10.0.0.2/cgi-bin/luci/', { status: 404, headers: {}, body: '' })
      .on(
        'POST http://10.0.0.2/ubus',
        json({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } }),
      );
    await expect(createProber(http).probe('10.0.0.2', signal)).resolves.toEqual({ scheme: 'http' });
  });

  it('tries HTTPS when port 80 is refused, and gives up on timeouts', async () => {
    const refused = new FakeHttpClient()
      .on('GET http://10.0.0.3/cgi-bin/luci/', new NativeError('ERR_UNREACHABLE', 'refused'))
      .on('GET https://10.0.0.3/cgi-bin/luci/', {
        status: 200,
        headers: {},
        body: '<link href="/luci-static/bootstrap/cascade.css">',
      });
    await expect(createProber(refused).probe('10.0.0.3', signal)).resolves.toEqual({
      scheme: 'https',
      hostname: undefined,
    });

    const silent = new FakeHttpClient().on(() => true, new NativeError('ERR_TIMEOUT', 'timeout'));
    await expect(createProber(silent).probe('10.0.0.4', signal)).resolves.toBeNull();
    expect(silent.requests).toHaveLength(1);
  });

  it('ignores ordinary web servers', async () => {
    const http = new FakeHttpClient()
      .on('GET http://10.0.0.5/cgi-bin/luci/', { status: 404, headers: {}, body: 'not found' })
      .on('POST http://10.0.0.5/ubus', { status: 404, headers: {}, body: '' });
    await expect(createProber(http).probe('10.0.0.5', signal)).resolves.toBeNull();
  });
});

it('parses LuCI titles', () => {
  expect(hostnameFromTitle('<title>OpenWrt - LuCI</title>')).toBe('OpenWrt');
  expect(hostnameFromTitle('<TITLE> My Router - LuCI </TITLE>')).toBe('My Router');
  expect(hostnameFromTitle('<title>Router</title>')).toBeUndefined();
});
