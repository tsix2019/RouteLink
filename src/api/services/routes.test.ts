import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import type { NetInterface } from './network';
import {
  deleteStaticRouteChanges,
  getRoutes,
  parseRoutes,
  parseStaticRoutes,
  staticRouteChanges,
  validateStaticRoute,
  type StaticRoute,
  type StaticRouteInput,
} from './routes';

// iproute2 (ip-full / ip-tiny) output.
const IP4 = `default via 192.168.1.1 dev eth1 proto static src 192.168.1.10 metric 10
10.8.0.0/24 dev wg0 proto kernel scope link src 10.8.0.1
172.16.10.0/24 via 192.168.2.2 dev br-lan proto static metric 5 onlink
192.168.2.0/24 dev br-lan proto kernel scope link src 192.168.2.1 linkdown
blackhole 10.99.0.0/16 proto static
default via 10.0.0.1 dev eth2 table 100 proto static
default proto static metric 20
	nexthop via 192.168.1.1 dev eth1 weight 1
	nexthop via 192.168.3.1 dev eth3 weight 2
local 127.0.0.1 dev lo table local proto kernel scope host src 127.0.0.1
broadcast 192.168.2.255 dev br-lan table local proto kernel scope link src 192.168.2.1
`;

// busybox ip (Docker rootfs images).
const BUSYBOX = `default via 172.31.0.1 dev eth1
172.30.0.0/24 dev eth0 scope link  src 172.30.0.2
local 127.0.0.0/8 dev lo table local scope host  src 127.0.0.1
`;

const IP6 = `default from 2001:db8:1::/48 via fe80::1 dev eth1 proto static metric 512 pref medium
2001:db8:1:10::/64 dev br-lan proto static metric 1024 pref medium
unreachable 2001:db8:1::/48 dev lo proto static metric 2147483647 pref medium
fe80::/64 dev br-lan proto kernel metric 256 pref medium
local ::1 dev lo table local proto kernel metric 0 pref medium
multicast ff00::/8 dev br-lan table local proto kernel metric 256 pref medium
`;

describe('parseRoutes', () => {
  it('reads every field of iproute2 output, multipath included', () => {
    const routes = parseRoutes(IP4, 4);
    expect(routes).toHaveLength(9);
    expect(routes[0]).toEqual({
      family: 4,
      type: 'unicast',
      target: 'default',
      via: '192.168.1.1',
      dev: 'eth1',
      table: 'main',
      proto: 'static',
      src: '192.168.1.10',
      metric: 10,
      flags: [],
    });
    expect(routes[2]).toMatchObject({ target: '172.16.10.0/24', via: '192.168.2.2', metric: 5, flags: ['onlink'] });
    expect(routes[3]).toMatchObject({ scope: 'link', flags: ['linkdown'] });
    expect(routes[4]).toMatchObject({ type: 'blackhole', target: '10.99.0.0/16', proto: 'static' });
    expect(routes[5]).toMatchObject({ target: 'default', table: '100' });
    expect(routes[6]).toMatchObject({
      target: 'default',
      metric: 20,
      nexthops: [
        { via: '192.168.1.1', dev: 'eth1', weight: 1 },
        { via: '192.168.3.1', dev: 'eth3', weight: 2 },
      ],
    });
    expect(routes[7]).toMatchObject({ type: 'local', target: '127.0.0.1', table: 'local', scope: 'host' });
    expect(routes[8]).toMatchObject({ type: 'broadcast', table: 'local' });
  });

  it('reads busybox output (double spaces)', () => {
    expect(parseRoutes(BUSYBOX, 4)).toEqual([
      { family: 4, type: 'unicast', target: 'default', via: '172.31.0.1', dev: 'eth1', table: 'main', flags: [] },
      {
        family: 4,
        type: 'unicast',
        target: '172.30.0.0/24',
        dev: 'eth0',
        table: 'main',
        scope: 'link',
        src: '172.30.0.2',
        flags: [],
      },
      {
        family: 4,
        type: 'local',
        target: '127.0.0.0/8',
        dev: 'lo',
        table: 'local',
        scope: 'host',
        src: '127.0.0.1',
        flags: [],
      },
    ]);
  });

  it('reads IPv6 routes with source prefixes and preferences', () => {
    const routes = parseRoutes(IP6, 6);
    expect(routes[0]).toEqual({
      family: 6,
      type: 'unicast',
      target: 'default',
      from: '2001:db8:1::/48',
      via: 'fe80::1',
      dev: 'eth1',
      table: 'main',
      proto: 'static',
      metric: 512,
      flags: [],
    });
    expect(routes[2]).toMatchObject({ type: 'unreachable', target: '2001:db8:1::/48', metric: 2147483647 });
    expect(routes.filter((r) => r.table === 'local').map((r) => r.type)).toEqual(['local', 'multicast']);
  });

  it('accepts "via inet6" gateways and ignores blank lines', () => {
    expect(parseRoutes('\n10.0.0.0/8 via inet6 fe80::2 dev eth0 \n\n', 4)).toEqual([
      { family: 4, type: 'unicast', target: '10.0.0.0/8', via: 'fe80::2', dev: 'eth0', table: 'main', flags: [] },
    ]);
  });
});

const network = {
  values: {
    lan: { '.name': 'lan', '.type': 'interface', '.index': 1, proto: 'static' },
    cfg0a1b2c: {
      '.name': 'cfg0a1b2c',
      '.type': 'route',
      '.anonymous': true,
      '.index': 4,
      interface: 'lan',
      target: '172.16.10.0/24',
      gateway: '192.168.2.2',
      metric: '5',
    },
    // Old style: separate netmask; a missing gateway means a device route.
    cfg0b1b2c: {
      '.name': 'cfg0b1b2c',
      '.type': 'route',
      '.anonymous': true,
      '.index': 5,
      interface: 'wan',
      target: '10.20.0.0',
      netmask: '255.255.0.0',
      table: '100',
    },
    cfg0c1b2c: {
      '.name': 'cfg0c1b2c',
      '.type': 'route6',
      '.anonymous': true,
      '.index': 6,
      interface: 'lan',
      target: '2001:db8:1:10::/64',
      type: 'unicast',
      disabled: '1',
    },
  },
};

describe('parseStaticRoutes', () => {
  it('reads route and route6 sections in file order', () => {
    expect(parseStaticRoutes(network.values)).toEqual([
      {
        section: 'cfg0a1b2c',
        family: 4,
        interface: 'lan',
        target: '172.16.10.0/24',
        gateway: '192.168.2.2',
        metric: '5',
        disabled: false,
      },
      {
        section: 'cfg0b1b2c',
        family: 4,
        interface: 'wan',
        target: '10.20.0.0/16',
        table: '100',
        netmask: '255.255.0.0',
        disabled: false,
      },
      {
        section: 'cfg0c1b2c',
        family: 6,
        interface: 'lan',
        target: '2001:db8:1:10::/64',
        type: 'unicast',
        disabled: true,
      },
    ]);
  });
});

describe('getRoutes', () => {
  const exec = (stdout: string, code = 0) => ok({ code, stdout });

  it('reads both tables and the static routes in one batch', async () => {
    const conn = new FixtureConnection('none')
      .override('file.exec.sbin-ip-4-route-show-table-all', exec(BUSYBOX))
      .override('file.exec.sbin-ip-6-route-show-table-all', exec(IP6))
      .override('uci.get.network', ok(network));
    const r = await getRoutes(conn);
    expect(conn.calls).toHaveLength(3);
    expect(r.kernel.filter((x) => x.family === 4)).toHaveLength(3);
    expect(r.kernel.filter((x) => x.family === 6)).toHaveLength(6);
    expect(r.statics.map((s) => s.section)).toEqual(['cfg0a1b2c', 'cfg0b1b2c', 'cfg0c1b2c']);
  });

  it('shows no IPv6 routes when the kernel has IPv6 off', async () => {
    const conn = new FixtureConnection('none')
      .override('file.exec.sbin-ip-4-route-show-table-all', exec(BUSYBOX))
      .override('file.exec.sbin-ip-6-route-show-table-all', exec('', 2))
      .override('uci.get.network', ok(network));
    expect((await getRoutes(conn)).kernel.every((x) => x.family === 4)).toBe(true);
  });

  it('fails when the routing table may not be read', async () => {
    const conn = new FixtureConnection('none')
      .override('file.exec.sbin-ip-4-route-show-table-all', fail('PERMISSION_DENIED'))
      .override('file.exec.sbin-ip-6-route-show-table-all', fail('PERMISSION_DENIED'))
      .override('uci.get.network', ok(network));
    await expect(getRoutes(conn)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

const lan = {
  name: 'lan',
  ipv4: [{ address: '192.168.2.1', mask: 24 }],
  ipv6: [{ address: 'fd00:8::1', mask: 64 }],
} as NetInterface;
const down = { name: 'vpn', ipv4: [], ipv6: [] } as unknown as NetInterface;

const input = (patch: Partial<StaticRouteInput> = {}): StaticRouteInput => ({
  family: 4,
  interface: 'lan',
  target: '172.16.10.0/24',
  gateway: '192.168.2.2',
  metric: '',
  table: '',
  ...patch,
});

describe('validateStaticRoute', () => {
  it('accepts a route through a gateway on the interface', () => {
    expect(validateStaticRoute(input(), lan)).toEqual({});
    expect(validateStaticRoute(input({ gateway: '' }), lan)).toEqual({});
    expect(validateStaticRoute(input({ family: 6, target: '2001:db8:5::/48', gateway: 'fe80::2' }), lan)).toEqual({});
    expect(validateStaticRoute(input({ family: 6, target: '2001:db8:5::/48', gateway: 'fd00:8::9' }), lan)).toEqual({});
  });

  it('checks each field', () => {
    expect(validateStaticRoute(input({ interface: '' }), undefined)).toEqual({ interface: 'interface-missing' });
    expect(validateStaticRoute(input({ target: '172.16.10/24' }), lan)).toEqual({ target: 'target-invalid' });
    expect(validateStaticRoute(input({ target: 'fd00::/8' }), lan)).toEqual({ target: 'target-invalid' });
    expect(validateStaticRoute(input({ gateway: '192.168.2' }), lan)).toEqual({ gateway: 'gateway-invalid' });
    expect(validateStaticRoute(input({ gateway: '10.0.0.1' }), lan)).toEqual({ gateway: 'gateway-outside' });
    expect(validateStaticRoute(input({ family: 6, target: '2001:db8:5::/48', gateway: '2001:db8:9::1' }), lan)).toEqual(
      {
        gateway: 'gateway-outside',
      },
    );
    expect(validateStaticRoute(input({ metric: '-1' }), lan)).toEqual({ metric: 'metric-invalid' });
    expect(validateStaticRoute(input({ metric: '4294967296' }), lan)).toEqual({ metric: 'metric-invalid' });
    expect(validateStaticRoute(input({ table: 'my table' }), lan)).toEqual({ table: 'table-invalid' });
  });

  it('cannot check the gateway of an interface without addresses', () => {
    expect(validateStaticRoute(input({ interface: 'vpn', gateway: '10.0.0.1' }), down)).toEqual({});
  });
});

describe('static route changes', () => {
  const existing = (patch: Partial<StaticRoute> = {}): StaticRoute => ({
    section: 'cfg0a1b2c',
    family: 4,
    interface: 'lan',
    target: '172.16.10.0/24',
    gateway: '192.168.2.2',
    metric: '5',
    disabled: false,
    ...patch,
  });

  it('adds a route or route6 section, writing the network address', () => {
    expect(staticRouteChanges(input({ target: '172.16.10.9/24', metric: '5' }))).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'network',
          type: 'route',
          values: { interface: 'lan', target: '172.16.10.0/24', gateway: '192.168.2.2', metric: '5' },
        },
      },
    ]);
    expect(staticRouteChanges(input({ family: 6, target: '2001:db8:5::1/48', gateway: '' }))[0].params).toEqual({
      config: 'network',
      type: 'route6',
      values: { interface: 'lan', target: '2001:db8:5::/48' },
    });
  });

  it('edits in place and removes cleared options and the old netmask', () => {
    expect(staticRouteChanges(input({ gateway: '', table: '100' }), existing({ netmask: '255.255.255.0' }))).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'network',
          section: 'cfg0a1b2c',
          values: { interface: 'lan', target: '172.16.10.0/24', table: '100' },
        },
      },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg0a1b2c', option: 'gateway' } },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg0a1b2c', option: 'metric' } },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg0a1b2c', option: 'netmask' } },
    ]);
  });

  it('refuses invalid input and family changes', () => {
    expect(() => staticRouteChanges(input({ target: 'nonsense' }))).toThrow(
      expect.objectContaining({ code: 'route-invalid' }),
    );
    expect(() => staticRouteChanges(input({ family: 6, target: '2001:db8::/32' }), existing())).toThrow(
      expect.objectContaining({ code: 'route-invalid' }),
    );
  });

  it('deletes the section', () => {
    expect(deleteStaticRouteChanges(existing())).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg0a1b2c' } },
    ]);
  });
});
