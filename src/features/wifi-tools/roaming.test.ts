import type { AgentEvent } from '@/api/services/agent';

import { roamingRecord } from './roaming';

const MAC = 'AA:BB:CC:00:00:01';
const ev = (ts: number, type: string, value?: number, mac = MAC): AgentEvent => ({ ts, type, mac, value });

describe('roamingRecord', () => {
  it('merges the routers, newest first, the connect above the disconnect of the same second', () => {
    const record = roamingRecord(
      [
        {
          routerId: 'gw',
          name: 'Gateway',
          events: [ev(1000, 'wifi_disconnect', 5180), ev(2200, 'wifi_connect', 5180), ev(1500, 'device_online')],
        },
        {
          routerId: 'ap',
          name: 'Kitchen',
          events: [ev(1000, 'wifi_connect', 2437), ev(2200, 'wifi_disconnect', 2437)],
        },
      ],
      MAC,
    );
    expect(record.map((e) => [e.ts, e.kind, e.apName, e.band, e.roamed])).toEqual([
      [2200, 'connect', 'Gateway', '5G', true],
      [2200, 'disconnect', 'Kitchen', '2.4G', false],
      [1000, 'connect', 'Kitchen', '2.4G', true],
      [1000, 'disconnect', 'Gateway', '5G', false],
    ]);
  });

  it('ignores other devices and matches MACs in any notation', () => {
    const record = roamingRecord(
      [
        {
          routerId: 'gw',
          name: 'Gateway',
          events: [
            ev(10, 'wifi_connect', 2412, 'aa-bb-cc-00-00-01'),
            ev(20, 'wifi_connect', 2412, 'AA:BB:CC:00:00:02'),
          ],
        },
      ],
      MAC.toLowerCase(),
    );
    expect(record).toEqual([
      { ts: 10, kind: 'connect', routerId: 'gw', apName: 'Gateway', band: '2.4G', roamed: false },
    ]);
  });

  it('does not call a reconnect to the same AP and band roaming', () => {
    const record = roamingRecord(
      [{ routerId: 'gw', name: 'Gateway', events: [ev(100, 'wifi_disconnect', 5180), ev(130, 'wifi_connect', 5180)] }],
      MAC,
    );
    expect(record.map((e) => e.roamed)).toEqual([false, false]);
  });

  it('counts a band change on the same AP, and a connect elsewhere without a disconnect', () => {
    const record = roamingRecord(
      [
        {
          routerId: 'gw',
          name: 'Gateway',
          events: [ev(100, 'wifi_connect', 2437), ev(5000, 'wifi_disconnect', 2437), ev(5010, 'wifi_connect', 5180)],
        },
        { routerId: 'ap', name: 'Kitchen', events: [ev(900, 'wifi_connect', 5180)] },
      ],
      MAC,
    );
    expect(record.map((e) => [e.ts, e.roamed])).toEqual([
      [5010, true],
      [5000, false],
      [900, true],
      [100, false],
    ]);
  });

  it('does not count a reconnect long after leaving another AP', () => {
    const record = roamingRecord(
      [
        { routerId: 'gw', name: 'Gateway', events: [ev(100, 'wifi_disconnect', 5180)] },
        { routerId: 'ap', name: 'Kitchen', events: [ev(3600, 'wifi_connect', 5180)] },
      ],
      MAC,
    );
    expect(record[0]).toMatchObject({ ts: 3600, roamed: false });
  });

  it('leaves the band unknown without a frequency', () => {
    expect(
      roamingRecord([{ routerId: 'gw', name: 'G', events: [ev(1, 'wifi_connect')] }], MAC)[0].band,
    ).toBeUndefined();
  });
});
