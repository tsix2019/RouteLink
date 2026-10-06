import type { RouterProfile } from '@/state/routers';

import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import type { Client } from '../services/clients';
import { apsOf, gatewayChoices, switcherTree } from './members';
import { mergeGroupClients, type LastSeenAp } from './merge';
import { getApStations, type ApReport } from './stations';

const profile = (id: string, order: number, extra: Partial<RouterProfile> = {}): RouterProfile => ({
  id,
  name: id,
  baseUrl: `http://${id}`,
  username: 'root',
  savePassword: true,
  order,
  createdAt: 0,
  ...extra,
});

describe('group members', () => {
  const routers = [
    profile('ap2', 3, { role: 'ap', gatewayId: 'gw' }),
    profile('gw', 0, { role: 'gateway' }),
    profile('ap1', 1, { role: 'ap', gatewayId: 'gw' }),
    profile('solo', 2),
    profile('orphan', 4, { role: 'ap', gatewayId: 'gone' }),
  ];

  it('lists the access points of a gateway in order', () => {
    expect(apsOf(routers, 'gw').map((r) => r.id)).toEqual(['ap1', 'ap2']);
  });

  it('nests access points under their gateway in the switcher', () => {
    expect(switcherTree(routers).map((e) => [e.router.id, e.aps.map((a) => a.id)])).toEqual([
      ['gw', ['ap1', 'ap2']],
      ['solo', []],
      ['orphan', []],
    ]);
  });

  it('offers gateways other than the router itself', () => {
    expect(gatewayChoices(routers, 'gw').map((r) => r.id)).toEqual([]);
    expect(gatewayChoices(routers, 'solo').map((r) => r.id)).toEqual(['gw']);
  });
});

const client = (mac: string, extra: Partial<Client> = {}): Client => ({
  mac,
  name: mac,
  vendor: null,
  randomizedMac: false,
  ipv4: '192.168.1.50',
  ipv6: [],
  online: false,
  onlineSource: 'none',
  connection: 'wired',
  isStatic: false,
  isBlocked: false,
  ...extra,
});

const report = (stations: [mac: string, inactiveMs: number, signal?: number][], ssid = 'Home'): ApReport => ({
  source: 'plugin',
  ifaces: [{ radio: 'radio0', section: 'default_radio0', ifname: 'phy0-ap0', ssid, band: '5G' }],
  stations: stations.map(([mac, inactiveMs, signal = -60]) => ({
    mac,
    ifname: 'phy0-ap0',
    ssid,
    band: '5G',
    signal,
    inactiveMs,
  })),
});

const GW = { id: 'gw', name: 'Gateway' };
const AP1 = { id: 'ap1', name: 'Living room' };
const AP2 = { id: 'ap2', name: 'Study' };

describe('mergeGroupClients', () => {
  it('takes Wi-Fi details from the AP and identity from the gateway', () => {
    const { clients, offline } = mergeGroupClients(
      GW,
      [client('AA:00:00:00:00:01', { name: 'Phone', ipv4: '192.168.1.20' })],
      [{ member: AP1, report: report([['AA:00:00:00:00:01', 100, -48]]) }],
    );
    expect(offline).toEqual([]);
    expect(clients[0]).toMatchObject({
      name: 'Phone',
      ipv4: '192.168.1.20',
      connection: 'wifi',
      online: true,
      wifi: { signal: -48, band: '5G', ssid: 'Home' },
      ap: { routerId: 'ap1', name: 'Living room', band: '5G' },
    });
  });

  it('prefers the AP that heard from a roaming client last', () => {
    const { clients } = mergeGroupClients(
      GW,
      [client('AA:00:00:00:00:01')],
      [
        { member: AP1, report: report([['AA:00:00:00:00:01', 9_000, -80]]) },
        { member: AP2, report: report([['AA:00:00:00:00:01', 20, -50]]) },
      ],
    );
    expect(clients[0].ap?.routerId).toBe('ap2');
    expect(clients[0].wifi?.signal).toBe(-50);
  });

  it("keeps the gateway's own wireless clients and labels them with the gateway", () => {
    const own = client('AA:00:00:00:00:02', {
      connection: 'wifi',
      online: true,
      wifi: { ifname: 'phy1-ap0', ssid: 'Home', band: '2.4G', signal: -55, inactiveMs: 10 },
    });
    const { clients } = mergeGroupClients(GW, [own], [{ member: AP1, report: report([]) }]);
    expect(clients[0].ap).toMatchObject({ routerId: 'gw', band: '2.4G' });
  });

  it('marks clients of an offline AP as unknown, where they were last seen', () => {
    const lastSeen: LastSeenAp = new Map();
    mergeGroupClients(GW, [client('AA:00:00:00:00:01')], [{ member: AP1, report: report([['AA:00:00:00:00:01', 5]]) }], lastSeen);
    const { clients, offline } = mergeGroupClients(
      GW,
      [client('AA:00:00:00:00:01', { online: true })],
      [{ member: AP1, report: null }],
      lastSeen,
    );
    expect(offline).toEqual([AP1]);
    expect(clients[0].wifi).toBeUndefined();
    expect(clients[0].ap).toMatchObject({ routerId: 'ap1', stale: true });
  });

  it('adds stations the gateway does not know', () => {
    const { clients } = mergeGroupClients(GW, [], [{ member: AP1, report: report([['3C:2E:F9:10:20:30', 5]]) }]);
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ mac: '3C:2E:F9:10:20:30', online: true, connection: 'wifi' });
  });
});

describe('getApStations', () => {
  it('falls back to iwinfo when the plugin is not installed', async () => {
    const conn = new FixtureConnection('handmade').override('routelink.stations', fail('PERMISSION_DENIED'));
    const r = await getApStations(conn);
    expect(r.source).toBe('iwinfo');
    expect(r.stations.map((s) => s.mac)).toContain('3C:2E:F9:10:20:30');
    expect(r.stations[0]).toMatchObject({ signal: -48, noise: -95, ifname: 'phy0-ap0' });
  });

  it('uses the plugin when it samples the AP', async () => {
    const conn = new FixtureConnection('handmade').override(
      'routelink.stations',
      ok({
        interfaces: [{ ifname: 'phy0-ap0', phy: 'phy0', ssid: 'Home', freq: 5180, channel: 36, stations: 1 }],
        stations: [{ mac: 'aa:bb:cc:00:00:01', ifname: 'phy0-ap0', freq: 5180, signal: -61, inactive_ms: 30, tx_rate: 866700 }],
      }),
    );
    const r = await getApStations(conn);
    expect(r.source).toBe('plugin');
    expect(r.stations).toEqual([
      expect.objectContaining({ mac: 'AA:BB:CC:00:00:01', band: '5G', ssid: 'Home', signal: -61, txRate: 866700 }),
    ]);
  });
});
