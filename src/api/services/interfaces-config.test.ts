import { FixtureConnection, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  getLanWan,
  lanChanges,
  leasesOutside,
  parseLanWan,
  validateLan,
  validateWan,
  wanChanges,
  type LanInput,
  type WanInput,
} from './interfaces-config';

const values = (version: string, config: string) =>
  (loadFixture(version, `uci.get.${config}`) as { ok: true; data: { values: Record<string, UciSection> } }).data.values;

describe('parseLanWan', () => {
  it('reads LAN as address and netmask (23.05, 24.10)', () => {
    const { lan, wan } = parseLanWan(values('openwrt-24.10.8', 'network'), values('openwrt-24.10.8', 'dhcp'));
    expect(lan).toEqual({
      ipaddr: '192.168.1.1',
      prefix: 24,
      style: 'netmask',
      dhcp: { section: 'lan', enabled: true, start: 100, limit: 150, leasetime: '12h' },
    });
    expect(wan).toEqual({ section: 'wan', proto: 'dhcp', device: 'eth1', dns: [], options: ['device', 'proto'] });
  });

  it('reads LAN as a CIDR list (25.12)', () => {
    const { lan } = parseLanWan(values('openwrt-25.12.5', 'network'), values('openwrt-25.12.5', 'dhcp'));
    expect(lan).toMatchObject({ ipaddr: '192.168.1.1', prefix: 24, style: 'cidr-list' });
  });

  it('reads static and PPPoE WANs with custom DNS and MTU', () => {
    const pppoe = parseLanWan(
      {
        wan: {
          '.name': 'wan',
          '.type': 'interface',
          device: 'eth1',
          proto: 'pppoe',
          username: 'user@isp',
          password: 'secret',
          peerdns: '0',
          dns: ['223.5.5.5', '119.29.29.29'],
          mtu: '1480',
        },
      },
      {},
    ).wan;
    expect(pppoe).toMatchObject({
      proto: 'pppoe',
      username: 'user@isp',
      password: 'secret',
      dns: ['223.5.5.5', '119.29.29.29'],
      mtu: '1480',
    });
    const fixed = parseLanWan(
      {
        wan: {
          '.name': 'wan',
          '.type': 'interface',
          proto: 'static',
          ipaddr: ['203.0.113.10/29'],
          gateway: '203.0.113.9',
          dns: '1.1.1.1 8.8.8.8',
        },
      },
      {},
    ).wan;
    expect(fixed).toMatchObject({
      proto: 'static',
      ipaddr: '203.0.113.10',
      netmask: '255.255.255.248',
      gateway: '203.0.113.9',
      dns: ['1.1.1.1', '8.8.8.8'],
    });
  });

  it('reads the LAN from the router', async () => {
    const conn = new FixtureConnection('openwrt-23.05.6');
    expect((await getLanWan(conn)).lan?.ipaddr).toBe('192.168.1.1');
  });
});

const wanInput = (patch: Partial<WanInput> = {}): WanInput => ({
  proto: 'dhcp',
  ipaddr: '',
  netmask: '',
  gateway: '',
  username: '',
  password: '',
  dns: '',
  mtu: '',
  ...patch,
});
const lanNet = { ipaddr: '192.168.1.1', prefix: 24 };

describe('validateWan', () => {
  it('accepts DHCP, static and PPPoE', () => {
    expect(validateWan(wanInput(), lanNet)).toEqual({});
    expect(
      validateWan(
        wanInput({ proto: 'static', ipaddr: '203.0.113.10', netmask: '255.255.255.248', gateway: '203.0.113.9' }),
        lanNet,
      ),
    ).toEqual({});
    expect(
      validateWan(
        wanInput({ proto: 'pppoe', username: 'u', password: 'p', mtu: '1492', dns: '223.5.5.5, 2400:3200::1' }),
        lanNet,
      ),
    ).toEqual({});
  });

  it('checks each field', () => {
    const fixed = (p: Partial<WanInput>) =>
      validateWan(
        wanInput({ proto: 'static', ipaddr: '203.0.113.10', netmask: '255.255.255.0', gateway: '203.0.113.1', ...p }),
        lanNet,
      );
    expect(fixed({ ipaddr: '203.0.113' })).toEqual({ ipaddr: 'ip-invalid' });
    expect(fixed({ ipaddr: '203.0.113.0' })).toEqual({ ipaddr: 'ip-invalid' });
    expect(fixed({ netmask: '255.0.255.0' })).toEqual({ netmask: 'netmask-invalid' });
    expect(fixed({ gateway: '198.51.100.1' })).toEqual({ gateway: 'gateway-outside' });
    expect(fixed({ gateway: '203.0.113.10' })).toEqual({ gateway: 'gateway-outside' });
    expect(fixed({ ipaddr: '192.168.1.20', gateway: '192.168.1.254' })).toEqual({ ipaddr: 'overlaps-lan' });
    expect(validateWan(wanInput({ proto: 'pppoe' }), lanNet)).toEqual({ username: 'username-missing' });
    expect(validateWan(wanInput({ dns: '1.1.1' }), lanNet)).toEqual({ dns: 'dns-invalid' });
    expect(validateWan(wanInput({ mtu: '100' }), lanNet)).toEqual({ mtu: 'mtu-invalid' });
  });
});

describe('wanChanges', () => {
  const current = parseLanWan(values('openwrt-24.10.8', 'network'), {}).wan!;

  it('switches DHCP to PPPoE with own DNS servers', () => {
    expect(
      wanChanges(
        wanInput({ proto: 'pppoe', username: 'u@isp', password: 'pw', dns: '223.5.5.5 119.29.29.29' }),
        current,
      ),
    ).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'network',
          section: 'wan',
          values: {
            proto: 'pppoe',
            username: 'u@isp',
            password: 'pw',
            peerdns: '0',
            dns: ['223.5.5.5', '119.29.29.29'],
          },
        },
      },
    ]);
  });

  it('removes what the old protocol and cleared fields leave behind', () => {
    const pppoe = parseLanWan(
      {
        wan: {
          '.name': 'wan',
          '.type': 'interface',
          device: 'eth1',
          proto: 'pppoe',
          username: 'u',
          password: 'p',
          peerdns: '0',
          dns: ['223.5.5.5'],
          mtu: '1480',
        },
      },
      {},
    ).wan!;
    expect(wanChanges(wanInput({ proto: 'dhcp' }), pppoe)).toEqual([
      { object: 'uci', method: 'set', params: { config: 'network', section: 'wan', values: { proto: 'dhcp' } } },
      ...['username', 'password', 'peerdns', 'dns', 'mtu'].map((option) => ({
        object: 'uci',
        method: 'delete',
        params: { config: 'network', section: 'wan', option },
      })),
    ]);
  });

  it('writes a static address the way the section holds it', () => {
    const cidr = parseLanWan(
      {
        wan: {
          '.name': 'wan',
          '.type': 'interface',
          proto: 'static',
          ipaddr: ['203.0.113.10/29'],
          gateway: '203.0.113.9',
        },
      },
      {},
    ).wan!;
    expect(
      wanChanges(
        wanInput({ proto: 'static', ipaddr: '203.0.113.11', netmask: '255.255.255.248', gateway: '203.0.113.9' }),
        cidr,
      )[0].params,
    ).toMatchObject({ values: { proto: 'static', ipaddr: ['203.0.113.11/29'], gateway: '203.0.113.9' } });
    expect(
      wanChanges(
        wanInput({ proto: 'static', ipaddr: '203.0.113.11', netmask: '255.255.255.248', gateway: '203.0.113.9' }),
        current,
      )[0].params,
    ).toMatchObject({
      values: { proto: 'static', ipaddr: '203.0.113.11', netmask: '255.255.255.248', gateway: '203.0.113.9' },
    });
  });
});

const lanInput = (patch: Partial<LanInput> = {}): LanInput => ({
  ipaddr: '192.168.1.1',
  netmask: '255.255.255.0',
  dhcp: true,
  start: '100',
  limit: '150',
  leasetime: '12h',
  ...patch,
});
const wanNet = { ipaddr: '10.0.2.15', prefix: 24 };

describe('validateLan', () => {
  it('accepts a usual LAN', () => {
    expect(validateLan(lanInput(), wanNet)).toEqual({});
    expect(
      validateLan(
        lanInput({ ipaddr: '10.10.0.1', netmask: '255.255.0.0', start: '1000', limit: '5000', leasetime: '1d' }),
        wanNet,
      ),
    ).toEqual({});
    expect(validateLan(lanInput({ dhcp: false, start: '', limit: '' }), undefined)).toEqual({});
  });

  it('checks each field', () => {
    expect(validateLan(lanInput({ ipaddr: '192.168.1.0' }), wanNet)).toEqual({ ipaddr: 'ip-invalid' });
    expect(validateLan(lanInput({ ipaddr: '192.168.1.255' }), wanNet)).toEqual({ ipaddr: 'ip-invalid' });
    expect(validateLan(lanInput({ netmask: '255.255.255.254' }), wanNet)).toEqual({ netmask: 'netmask-invalid' });
    expect(validateLan(lanInput({ ipaddr: '10.0.2.1' }), wanNet)).toEqual({ ipaddr: 'overlaps-wan' });
    expect(validateLan(lanInput({ start: '0' }), wanNet)).toEqual({ start: 'start-invalid' });
    expect(validateLan(lanInput({ limit: 'x' }), wanNet)).toEqual({ limit: 'limit-invalid' });
    expect(validateLan(lanInput({ start: '200', limit: '100' }), wanNet)).toEqual({ limit: 'pool-outside' });
    expect(validateLan(lanInput({ leasetime: '1 day' }), wanNet)).toEqual({ leasetime: 'leasetime-invalid' });
    expect(validateLan(lanInput({ leasetime: '30s' }), wanNet)).toEqual({ leasetime: 'leasetime-invalid' });
  });
});

describe('lanChanges', () => {
  const lan24 = parseLanWan(values('openwrt-24.10.8', 'network'), values('openwrt-24.10.8', 'dhcp')).lan!;
  const lan25 = parseLanWan(values('openwrt-25.12.5', 'network'), values('openwrt-25.12.5', 'dhcp')).lan!;

  it('changes address and pool, keeping the config style', () => {
    expect(lanChanges(lanInput({ ipaddr: '192.168.8.1', start: '50', limit: '100', leasetime: '1d' }), lan24)).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'network', section: 'lan', values: { ipaddr: '192.168.8.1', netmask: '255.255.255.0' } },
      },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'dhcp', section: 'lan', values: { start: '50', limit: '100', leasetime: '1d' } },
      },
    ]);
    expect(lanChanges(lanInput({ ipaddr: '192.168.8.1' }), lan25)[0].params).toEqual({
      config: 'network',
      section: 'lan',
      values: { ipaddr: ['192.168.8.1/24'] },
    });
  });

  it('leaves out what did not change and switches the DHCP server off', () => {
    expect(lanChanges(lanInput(), lan24)).toEqual([]);
    expect(lanChanges(lanInput({ dhcp: false }), lan24)).toEqual([
      { object: 'uci', method: 'set', params: { config: 'dhcp', section: 'lan', values: { ignore: '1' } } },
    ]);
  });
});

describe('leasesOutside', () => {
  it('lists static leases the new subnet would strand', () => {
    const dhcp: Record<string, UciSection> = {
      a: { '.name': 'a', '.type': 'host', name: 'NAS', mac: '00:11:32:00:00:01', ip: '192.168.1.20' },
      b: { '.name': 'b', '.type': 'host', name: 'AP', mac: '00:11:32:00:00:02', ip: '192.168.8.2' },
      c: { '.name': 'c', '.type': 'host', name: 'Printer', mac: '00:11:32:00:00:03' },
    };
    expect(leasesOutside(dhcp, '192.168.8.1', 24)).toEqual([{ name: 'NAS', ip: '192.168.1.20' }]);
  });
});

describe('getLanWan', () => {
  it('reads network and dhcp in one batch', async () => {
    const conn = new FixtureConnection('none')
      .override('uci.get.network', ok({ values: values('openwrt-24.10.8', 'network') }))
      .override('uci.get.dhcp', ok({ values: values('openwrt-24.10.8', 'dhcp') }));
    const r = await getLanWan(conn);
    expect(conn.calls).toHaveLength(2);
    expect(r.wan?.proto).toBe('dhcp');
  });
});
