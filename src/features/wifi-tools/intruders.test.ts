import type { Client } from '@/api/services/clients';
import type { Radio, WifiNetwork } from '@/api/services/wireless';

import {
  defaultScope,
  initialSelection,
  inScope,
  intruderRows,
  intruderSummary,
  needsTrustSetup,
  networkFor,
  networkHref,
  phoneSsid,
} from './intruders';

function client(name: string, mac: string, o: Partial<Client> = {}): Client {
  return {
    mac,
    name,
    vendor: null,
    randomizedMac: false,
    ipv6: [],
    online: true,
    onlineSource: 'wifi',
    connection: 'wifi',
    isStatic: false,
    isBlocked: false,
    ...o,
  };
}

const onWifi = (ssid: string, signal = -60): NonNullable<Client['wifi']> => ({
  ifname: 'phy1-ap0',
  ssid,
  band: '5G',
  signal,
});

const clients: Client[] = [
  client('Phone', '02:00:00:00:00:01', { ipv4: '192.168.1.20', wifi: onWifi('Home'), randomizedMac: true }),
  client('Laptop', 'AA:00:00:00:00:02', { ipv4: '192.168.1.21', wifi: onWifi('Home') }),
  client('Unknown', 'AA:00:00:00:00:03', {
    ipv4: '192.168.1.22',
    wifi: onWifi('Home'),
    ap: { routerId: 'ap1', name: 'Kitchen', band: '5G', ssid: 'Home' },
  }),
  client('Guest phone', 'AA:00:00:00:00:04', { ipv4: '192.168.2.5', wifi: onWifi('Home-Guest') }),
  // On an AP that does not answer: the SSID it was last seen on.
  client('Camera', 'AA:00:00:00:00:05', {
    ipv4: '192.168.1.23',
    ap: { routerId: 'ap2', name: 'Garage', ssid: 'Home', stale: true },
  }),
  client('Desktop', 'AA:00:00:00:00:06', { ipv4: '192.168.1.24', connection: 'wired', onlineSource: 'neighbor' }),
  client('Kitchen AP', 'AA:00:00:00:00:07', { ipv4: '192.168.1.2', connection: 'wired', onlineSource: 'neighbor' }),
  client('Gone', 'AA:00:00:00:00:08', { online: false, onlineSource: 'none', wifi: undefined }),
];

describe('scope', () => {
  it('finds the SSID the phone is on, none when it is wired or not in the list', () => {
    expect(phoneSsid(clients, '192.168.1.20')).toBe('Home');
    expect(phoneSsid(clients, '192.168.1.24')).toBeUndefined();
    expect(phoneSsid(clients, '10.0.0.9')).toBeUndefined();
    expect(defaultScope('Home')).toBe('ssid');
    expect(defaultScope(undefined)).toBe('wifi');
  });

  it('filters online devices by SSID (on every AP), Wi-Fi, or everything', () => {
    const names = (scope: 'ssid' | 'wifi' | 'all', ssid?: string) =>
      clients.filter((c) => inScope(c, scope, ssid)).map((c) => c.name);
    expect(names('ssid', 'Home')).toEqual(['Phone', 'Laptop', 'Unknown', 'Camera']);
    expect(names('wifi')).toEqual(['Phone', 'Laptop', 'Unknown', 'Guest phone', 'Camera']);
    expect(names('all')).toHaveLength(7);
    expect(names('ssid')).toEqual([]);
  });
});

describe('intruderRows', () => {
  const ctx = {
    ssid: 'Home',
    trusted: new Set(['AA:00:00:00:00:02']),
    phoneIp: '192.168.1.20',
    routers: new Map([['192.168.1.2', 'Kitchen AP']]),
  };

  it('puts strangers first, then the phone, trusted devices and the group’s routers', () => {
    const rows = intruderRows(clients, 'all', ctx);
    expect(rows.map((r) => r.client.name)).toEqual([
      'Camera',
      'Desktop',
      'Guest phone',
      'Unknown',
      'Phone',
      'Laptop',
      'Kitchen AP',
    ]);
    expect(rows.find((r) => r.phone)).toMatchObject({ stranger: false, trusted: false, random: true });
    expect(rows.find((r) => r.trusted)?.client.name).toBe('Laptop');
    expect(rows.find((r) => r.router)).toMatchObject({ router: 'Kitchen AP', stranger: false });
  });

  it('summarises the scope', () => {
    expect(intruderSummary(intruderRows(clients, 'ssid', ctx))).toEqual({ online: 4, strangers: 2 });
    expect(intruderSummary([])).toEqual({ online: 0, strangers: 0 });
  });

  it('asks to mark the user’s devices while nothing is trusted, with the phone ticked', () => {
    const fresh = intruderRows(clients, 'ssid', { ...ctx, trusted: new Set<string>() });
    expect(fresh.filter((r) => r.stranger)).toHaveLength(3);
    expect(needsTrustSetup(new Set(), fresh)).toBe(true);
    expect(needsTrustSetup(ctx.trusted, fresh)).toBe(false);
    expect([...initialSelection(fresh)]).toEqual(['02:00:00:00:00:01']);
  });
});

describe('networkFor', () => {
  const net = (section: string, ifname: string | undefined, ssid: string): WifiNetwork => ({
    section,
    radio: 'radio1',
    ifname,
    ssid,
    encryption: 'psk2',
    hidden: false,
    disabled: false,
    network: ['lan'],
    mode: 'ap',
    up: true,
  });
  const radios: Radio[] = [
    {
      name: 'radio0',
      band: '2.4G',
      channel: '1',
      disabled: false,
      up: true,
      networks: [net('default_radio0', 'phy0-ap0', 'Home')],
    },
    {
      name: 'radio1',
      band: '5G',
      channel: '36',
      disabled: false,
      up: true,
      networks: [net('default_radio1', 'phy1-ap0', 'Home'), net('guest', 'phy1-ap1', 'Home-Guest')],
    },
  ];

  it('finds the network by interface, then by SSID', () => {
    expect(networkFor(radios, clients[0])?.section).toBe('default_radio1');
    expect(networkFor(radios, clients[3])?.section).toBe('guest');
    expect(networkFor(radios, clients[4])?.section).toBe('default_radio0');
    expect(networkFor(radios, clients[5])).toBeUndefined();
    expect(networkFor(undefined, clients[0])).toBeUndefined();
  });

  it('links to the edit page, on an AP with its id', () => {
    expect(networkHref('default_radio1')).toBe('/wireless/network/default_radio1');
    expect(networkHref('default_radio1', 'ap 1')).toBe('/wireless/network/default_radio1?router=ap%201');
  });
});
