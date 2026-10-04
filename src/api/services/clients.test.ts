import { FixtureConnection, loadFixture } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  BLOCK_RULE_PREFIX,
  bandOf,
  getClients,
  mergeClients,
  parseNeighbors,
  parseWifiIfaces,
  type ClientInputs,
} from './clients';
import { parseCidr } from '@/utils/net';

const lan = [parseCidr('192.168.1.0/24')];
const wifi24 = { radio: 'radio0', section: 'default_radio0', ifname: 'phy0-ap0', ssid: 'Home', band: '2.4G' as const };

function inputs(over: Partial<ClientInputs> = {}): ClientInputs {
  return {
    leases: [],
    hints: {},
    stations: [],
    dhcpHosts: [],
    firewallRules: [],
    neighbors: [],
    ownMacs: new Set(),
    lanSubnets: lan,
    ...over,
  };
}

const host = (name: string, mac: string, extra: Record<string, string> = {}) =>
  ({ '.name': `cfg_${name}`, '.type': 'host', name, mac, ...extra }) as UciSection;

describe('mergeClients', () => {
  it('merges a lease and a Wi-Fi station into one online client', () => {
    const [c] = mergeClients(
      inputs({
        leases: [{ macaddr: '3c:2e:f9:10:20:30', ipaddr: '192.168.1.20', hostname: 'iPhone', expires: 3000 }],
        stations: [
          { iface: wifi24, list: [{ mac: '3C:2E:F9:10:20:30', signal: -48, inactiveMs: 40, rxRate: 144400 }] },
        ],
      }),
    );
    expect(c).toMatchObject({
      mac: '3C:2E:F9:10:20:30',
      name: 'iPhone',
      ipv4: '192.168.1.20',
      online: true,
      onlineSource: 'wifi',
      connection: 'wifi',
      vendor: 'Apple',
      wifi: { ssid: 'Home', band: '2.4G', signal: -48, rxRate: 144400 },
    });
  });

  it('marks wired clients online from the neighbour table', () => {
    const [c] = mergeClients(
      inputs({
        leases: [{ macaddr: '00:1a:11:00:00:01', ipaddr: '192.168.1.30', hostname: '*', expires: 100 }],
        neighbors: [{ ip: '192.168.1.30', mac: '00:1a:11:00:00:01', dev: 'br-lan', state: 'REACHABLE' }],
      }),
    );
    expect(c).toMatchObject({ online: true, onlineSource: 'neighbor', connection: 'wired', name: 'Google' });
    expect(c.hostname).toBeUndefined();
  });

  it('treats FAILED neighbours as offline and falls back to leases when the table is unavailable', () => {
    const lease = { macaddr: '00:1a:11:00:00:02', ipaddr: '192.168.1.31', expires: 50 };
    const [failed] = mergeClients(
      inputs({
        leases: [lease],
        neighbors: [{ ip: lease.ipaddr, mac: lease.macaddr, dev: 'br-lan', state: 'FAILED' }],
      }),
    );
    expect(failed.online).toBe(false);
    const [byLease] = mergeClients(inputs({ leases: [lease], neighbors: undefined }));
    expect(byLease).toMatchObject({ online: true, onlineSource: 'lease' });
  });

  it('lists static leases of offline devices with their alias', () => {
    const [c] = mergeClients(inputs({ dhcpHosts: [host('Printer', 'aa:bb:cc:00:11:22', { ip: '192.168.1.50' })] }));
    expect(c).toMatchObject({
      name: 'Printer',
      alias: 'Printer',
      isStatic: true,
      staticIp: '192.168.1.50',
      online: false,
      ipv4: '192.168.1.50',
      hostSection: 'cfg_Printer',
    });
  });

  it('keeps alias-only hosts non-static', () => {
    const [c] = mergeClients(inputs({ dhcpHosts: [host('TV', 'aa:bb:cc:00:11:23')] }));
    expect(c).toMatchObject({ name: 'TV', isStatic: false, hostSection: 'cfg_TV' });
  });

  it('detects RouteLink block rules, ignoring disabled ones', () => {
    const rule = (name: string, mac: string, enabled?: string) =>
      ({
        '.name': `r_${mac}`,
        '.type': 'rule',
        name,
        src_mac: [mac],
        ...(enabled ? { enabled } : {}),
      }) as unknown as UciSection;
    const out = mergeClients(
      inputs({
        firewallRules: [
          rule(`${BLOCK_RULE_PREFIX}AA:BB:CC:00:00:01`, 'AA:BB:CC:00:00:01'),
          rule(`${BLOCK_RULE_PREFIX}AA:BB:CC:00:00:02`, 'AA:BB:CC:00:00:02', '0'),
          rule('Something else', 'AA:BB:CC:00:00:03'),
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ mac: 'AA:BB:CC:00:00:01', isBlocked: true, blockSection: 'r_AA:BB:CC:00:00:01' });
  });

  it('flags randomized MACs without a vendor', () => {
    const [c] = mergeClients(
      inputs({ leases: [{ macaddr: 'DA:A1:19:00:00:01', ipaddr: '192.168.1.40', expires: 10 }] }),
    );
    expect(c).toMatchObject({ vendor: null, randomizedMac: true, name: 'DA:A1:19:00:00:01' });
  });

  it('ignores the router itself and hint-only hosts outside the LAN', () => {
    const out = mergeClients(
      inputs({
        hints: {
          'AA:00:00:00:00:01': { ipaddrs: ['192.168.1.1'], name: 'router.lan' },
          'AA:00:00:00:00:02': { ipaddrs: ['100.64.0.1'], name: 'isp-modem' },
          'AA:00:00:00:00:03': { ipaddrs: ['192.168.1.77'], name: 'laptop.lan' },
        },
        ownMacs: new Set(['AA:00:00:00:00:01']),
      }),
    );
    expect(out.map((c) => c.name)).toEqual(['laptop']);
  });

  it('sorts online clients first, then by name', () => {
    const out = mergeClients(
      inputs({
        leases: [
          { macaddr: '00:00:00:00:00:0a', ipaddr: '192.168.1.10', hostname: 'zeta', expires: 10 },
          { macaddr: '00:00:00:00:00:0b', ipaddr: '192.168.1.11', hostname: 'alpha', expires: 10 },
        ],
        dhcpHosts: [host('beta', '00:00:00:00:00:0c', { ip: '192.168.1.12' })],
        neighbors: undefined,
      }),
    );
    expect(out.map((c) => c.name)).toEqual(['alpha', 'zeta', 'beta']);
  });
});

describe('parsers', () => {
  it('parses busybox ip neigh output', () => {
    expect(
      parseNeighbors(
        '192.168.1.5 dev br-lan lladdr aa:bb:cc:dd:ee:ff ref 1 used 0/0/0 probes 1 REACHABLE\n192.168.1.9 dev br-lan  FAILED\n',
      ),
    ).toEqual([{ ip: '192.168.1.5', dev: 'br-lan', mac: 'aa:bb:cc:dd:ee:ff', state: 'REACHABLE' }]);
  });

  it('extracts access points and bands from getWirelessDevices', () => {
    const radios = loadFixture('handmade', 'luci-rpc.getWirelessDevices');
    const ifs = parseWifiIfaces(radios.ok ? (radios.data as never) : {});
    expect(ifs).toEqual([
      { radio: 'radio0', section: 'default_radio0', ifname: 'phy0-ap0', ssid: 'RouteLink', band: '2.4G' },
      { radio: 'radio1', section: 'default_radio1', ifname: 'phy1-ap0', ssid: 'RouteLink-5G', band: '5G' },
    ]);
  });

  it.each([
    [{ band: '2g' }, '2.4G'],
    [{ band: '5g' }, '5G'],
    [{ band: '6g' }, '6G'],
    [{ hwmode: '11a' }, '5G'],
    [{ hwmode: '11g' }, '2.4G'],
    [{ channel: '149' }, '5G'],
    [{ channel: 'auto' }, '2.4G'],
  ])('bandOf(%p) = %s', (config, band) => {
    expect(bandOf(config)).toBe(band);
  });
});

describe('getClients', () => {
  it('lists the Docker LAN gateway and skips the router itself (24.10 fixture)', async () => {
    const clients = await getClients(new FixtureConnection());
    expect(clients.map((c) => c.ipv4)).toEqual(['172.30.0.1']);
    expect(clients[0]).toMatchObject({ online: true, onlineSource: 'neighbor', connection: 'wired' });
  });

  it('adds Wi-Fi stations from every access point', async () => {
    const conn = new FixtureConnection()
      .override('luci-rpc.getWirelessDevices', loadFixture('handmade', 'luci-rpc.getWirelessDevices'))
      .override('iwinfo.assoclist.phy0-ap0', loadFixture('handmade', 'iwinfo.assoclist.phy0-ap0'))
      .override('iwinfo.assoclist.phy1-ap0', loadFixture('handmade', 'iwinfo.assoclist.phy1-ap0'));
    const clients = await getClients(conn);
    const wifi = clients.filter((c) => c.connection === 'wifi');
    expect(wifi.map((c) => [c.mac, c.wifi?.band, c.wifi?.ssid])).toEqual([
      ['3C:2E:F9:10:20:30', '2.4G', 'RouteLink'],
      ['DA:A1:19:AA:BB:CC', '5G', 'RouteLink-5G'],
    ]);
  });
});
