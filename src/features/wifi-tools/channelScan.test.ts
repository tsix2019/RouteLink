import { DemoApConnection, DemoConnection } from '@/api/connection/demo/connection';

import {
  adviseGroup,
  allowedChannels,
  bandRange,
  busyByChannel,
  chartNetworks,
  htmodeAt20,
  scanRouter,
  type FreqInfo,
} from './channelScan';

const NOW = 1_800_000_000_000;

function demo() {
  const conn = new DemoConnection(2026, () => NOW, 0);
  return { conn, ap: new DemoApConnection(conn) };
}

const FREQS_5G: FreqInfo[] = [
  36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165,
].map((channel) => ({ channel, restricted: channel >= 52 && channel <= 144 }));

describe('allowedChannels', () => {
  it('keeps radar channels for the DFS option and drops other restricted ones', () => {
    const freqs: FreqInfo[] = [
      { channel: 1, restricted: false },
      { channel: 12, restricted: true },
      { channel: 13, restricted: false },
    ];
    expect(allowedChannels('2.4G', freqs, 20)).toEqual([1, 13]);
    expect(allowedChannels('5G', FREQS_5G, 20)).toContain(52);
  });

  it('needs the whole block at 80 MHz', () => {
    const at80 = allowedChannels('5G', FREQS_5G, 80);
    expect(at80).toContain(36);
    expect(at80).toContain(161);
    expect(at80).not.toContain(165);
    // 144's block (132–144) is complete; without 140 it is not.
    expect(
      allowedChannels(
        '5G',
        FREQS_5G.filter((f) => f.channel !== 140),
        80,
      ),
    ).not.toContain(144);
  });
});

describe('scanRouter on the demo group', () => {
  it('scans every radio with its channel, BSSIDs, channel list and the plugin’s load', async () => {
    const { conn, ap } = demo();
    const gw = await scanRouter(conn, { id: 'gw', name: 'Gateway' });
    expect(gw.radios.map((r) => [r.key, r.band, r.channel, r.width])).toEqual([
      ['gw/radio0', '2.4G', 6, 20],
      ['gw/radio1', '5G', 36, 80],
    ]);
    expect(gw.radios[1].bssids).toEqual(['94:83:C4:00:00:02']);
    expect(gw.radios[1].freqs.length).toBeGreaterThan(20);
    // The gateway hears the AP's 5 GHz network and the neighbours.
    expect(gw.radios[1].scan.map((n) => n.bssid)).toContain('94:83:C4:00:01:02');
    expect(gw.radios[1].busy[36]).toEqual(expect.any(Number));
    expect(gw.radios.every((r) => !r.scanFailed)).toBe(true);

    const a = await scanRouter(ap, { id: 'ap', name: 'AP' });
    expect(a.radios.map((r) => [r.channel, r.width])).toEqual([
      [1, 40],
      [36, 80],
    ]);
  });

  it('advises every radio of the group; the 5 GHz pair on channel 36 moves once DFS is allowed', async () => {
    const { conn, ap } = demo();
    const radios = [
      ...(await scanRouter(conn, { id: 'gw', name: 'Gateway' })).radios,
      ...(await scanRouter(ap, { id: 'ap', name: 'AP' })).radios,
    ];
    const fives = (dfs: boolean) => ['gw/radio1', 'ap/radio1'].map((k) => adviseGroup(radios, dfs).get(k)!);
    expect(adviseGroup(radios, false).size).toBe(4);
    // Without DFS the only other block (149) has a strong neighbour: staying is better.
    expect(fives(false).map((a) => a.reason)).toEqual(['keep-best', 'keep-best']);
    const moved = fives(true).filter((a) => a.reason === 'change');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((a) => a.dfs && a.reduction > 0.5)).toBe(true);
  });

  it('marks the group’s own networks in the chart', async () => {
    const { conn, ap } = demo();
    const gw = (await scanRouter(conn, { id: 'gw', name: 'Gateway' })).radios[1];
    const a = (await scanRouter(ap, { id: 'ap', name: 'AP' })).radios[1];
    const own = new Set([...gw.bssids, ...a.bssids]);
    const nets = chartNetworks(gw, own);
    expect(nets.filter((n) => n.own)).toHaveLength(1);
    const xiaomi = nets.find((n) => n.ssid === 'Xiaomi_AX6000')!;
    expect([xiaomi.low, xiaomi.high]).toEqual([5170, 5250]);
  });
});

it('takes the busy share of the scanning radio’s channels', () => {
  const survey = {
    radios: [{ ifname: 'phy1-ap0', phy: 'phy1', freq: 5180, channel: 36, busyPct: 23, updated: 0 }],
    channels: [
      { phy: 'phy1', freq: 5180, channel: 36, busyPct: 40 },
      { phy: 'phy1', freq: 5745, channel: 149, busyPct: 12 },
      { phy: 'phy0', freq: 2412, channel: 1, busyPct: 50 },
      { phy: 'phy1', freq: 5200, channel: 40, busyPct: null },
    ],
  };
  expect(busyByChannel(survey, 'phy1-ap0')).toEqual({ 36: 23, 149: 12 });
  expect(busyByChannel(survey, 'phy0-ap0')).toEqual({});
  expect(busyByChannel(undefined, 'phy1-ap0')).toEqual({});
});

it('turns a 40 MHz mode into its 20 MHz one', () => {
  expect(htmodeAt20('HT40')).toBe('HT20');
  expect(htmodeAt20('HE40')).toBe('HE20');
  expect(htmodeAt20('HE20')).toBeUndefined();
  expect(htmodeAt20(undefined)).toBeUndefined();
});

it('spans the band’s channels on the chart', () => {
  expect(bandRange('2.4G', [1, 6, 11, 13])).toEqual({ low: 2402, high: 2482 });
  expect(bandRange('5G', [])).toEqual({ low: 5170, high: 5835 });
});
