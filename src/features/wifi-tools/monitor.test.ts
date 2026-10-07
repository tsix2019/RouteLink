import type { Client } from '@/api/services/clients';

import { findPhone, gradeCounts, signalHref, signalRows, sortSignalRows } from './monitor';

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

const wifi = (signal: number, o: Partial<NonNullable<Client['wifi']>> = {}): NonNullable<Client['wifi']> => ({
  ifname: 'phy1-ap0',
  ssid: 'Home',
  band: '5G',
  signal,
  ...o,
});

const clients: Client[] = [
  client('TV', 'AA:00:00:00:00:01', {
    ipv4: '192.168.1.10',
    wifi: wifi(-78, { noise: -92, rxRate: 200_000, txRate: 300_000 }),
    ap: { routerId: 'ap1', name: 'Kitchen', band: '5G', ssid: 'Home' },
  }),
  client('Phone', 'AA:00:00:00:00:02', { ipv4: '192.168.1.20', wifi: wifi(-52, { noise: -95 }) }),
  client('Laptop', 'AA:00:00:00:00:03', { ipv4: '192.168.1.30', wifi: wifi(-65) }),
  client('NAS', 'AA:00:00:00:00:04', { ipv4: '192.168.1.40', connection: 'wired', onlineSource: 'neighbor' }),
  client('Old tablet', 'AA:00:00:00:00:05', { online: false, onlineSource: 'none' }),
  // Its AP does not answer: no Wi-Fi details to show.
  client('Camera', 'AA:00:00:00:00:06', { ap: { routerId: 'ap2', name: 'Garage', stale: true } }),
];

describe('signalRows', () => {
  it('lists online clients with Wi-Fi details, graded, with the AP they are on', () => {
    const rows = signalRows(clients, '192.168.1.20');
    expect(rows.map((r) => r.name)).toEqual(['TV', 'Phone', 'Laptop']);
    // −78 dBm is fair; an SNR of 14 dB (under 20) costs a grade.
    expect(rows[0]).toMatchObject({ grade: 'poor', snr: 14, bars: 1, apId: 'ap1', apName: 'Kitchen', isPhone: false });
    expect(rows[1]).toMatchObject({ grade: 'excellent', snr: 43, isPhone: true, apId: undefined });
    expect(rows[2]).toMatchObject({ grade: 'good', snr: undefined });
  });

  it('finds the phone by its IPv4 address only', () => {
    expect(findPhone(clients, '192.168.1.30')?.name).toBe('Laptop');
    expect(findPhone(clients, null)).toBeUndefined();
    expect(findPhone(clients, '10.0.0.1')).toBeUndefined();
  });
});

describe('sortSignalRows', () => {
  const rows = signalRows(clients);

  it('puts the weakest first', () => {
    expect(sortSignalRows(rows, 'weakest').map((r) => r.signal)).toEqual([-78, -65, -52]);
  });

  it('sorts by name', () => {
    expect(sortSignalRows(rows, 'name').map((r) => r.name)).toEqual(['Laptop', 'Phone', 'TV']);
  });

  it('keeps the input untouched', () => {
    sortSignalRows(rows, 'weakest');
    expect(rows.map((r) => r.name)).toEqual(['TV', 'Phone', 'Laptop']);
  });
});

it('counts the grades', () => {
  expect(gradeCounts(signalRows(clients))).toEqual({ excellent: 1, good: 1, fair: 0, poor: 1 });
});

it('builds the detail route with the AP', () => {
  expect(signalHref('AA:00:00:00:00:01', 'ap1')).toBe('/wireless/tools/signal/AA%3A00%3A00%3A00%3A00%3A01?router=ap1');
  expect(signalHref('AA:00:00:00:00:02')).toBe('/wireless/tools/signal/AA%3A00%3A00%3A00%3A00%3A02');
});
