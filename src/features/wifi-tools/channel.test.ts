import { loadFixture } from '../../../test/fixture-connection';
import {
  channelTable,
  isDfs,
  parseScan,
  recommendChannels,
  spanOf,
  widthOfHtmode,
  type OwnRadio,
  type ScannedNetwork,
} from './channel';
import { gradeSignal, isRateLow, retryRate, signalBars, signalTips } from './signal';

const net = (channel: number, signal: number, extra: Partial<ScannedNetwork> = {}): ScannedNetwork => ({
  bssid: `02:00:00:00:${String(channel).padStart(2, '0')}:${String(-signal).padStart(2, '0')}`,
  ssid: 'neighbour',
  band: '2.4G',
  channel,
  signal,
  width: 20,
  ...extra,
});

const radio24 = (scan: ScannedNetwork[], extra: Partial<OwnRadio> = {}): OwnRadio => ({
  key: 'gw/radio0',
  band: '2.4G',
  channel: 1,
  width: 20,
  allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  bssids: ['AA:00:00:00:00:01'],
  scan,
  ...extra,
});

describe('spans', () => {
  it('places 2.4 GHz HT40 above or below the primary channel', () => {
    expect(spanOf('2.4G', 1, 40)).toEqual({ low: 2402, high: 2442 });
    expect(spanOf('2.4G', 11, 40)).toEqual({ low: 2432, high: 2472 });
  });

  it('uses the 5 GHz channel blocks', () => {
    expect(spanOf('5G', 44, 80)).toEqual({ low: 5170, high: 5250 });
    expect(spanOf('5G', 149, 40)).toEqual({ low: 5735, high: 5775 });
    expect(spanOf('5G', 36, 80, 42)).toEqual({ low: 5170, high: 5250 });
  });

  it('knows DFS channels', () => {
    expect([36, 52, 64, 100, 144, 149].map((c) => isDfs('5G', c))).toEqual([false, true, true, true, true, false]);
  });
});

describe('recommendChannels', () => {
  it('moves away from a strong neighbour when it halves the interference', () => {
    const [advice] = recommendChannels([radio24([net(1, -45), net(11, -85)])]);
    expect(advice.reason).toBe('change');
    expect(advice.recommended).toBe(6);
    expect(advice.reduction).toBeGreaterThan(0.5);
  });

  it('only chooses 1, 6 or 11 on 2.4 GHz', () => {
    const [advice] = recommendChannels([radio24([net(1, -40), net(6, -40), net(11, -40), net(3, -90)])]);
    expect([undefined, 1, 6, 11]).toContain(advice.recommended);
  });

  it('keeps the channel when the gain is small', () => {
    const [advice] = recommendChannels([radio24([net(1, -70), net(6, -68), net(11, -69)], { channel: 6 })]);
    expect(advice.recommended).toBeUndefined();
    expect(advice.reason).toBe('keep-small-gain');
  });

  it('ignores its own networks', () => {
    const own = net(1, -30, { bssid: 'AA:00:00:00:00:01' });
    const [advice] = recommendChannels([radio24([own])]);
    expect(advice.currentScore).toBe(0);
    expect(advice.reason).toBe('keep-best');
  });

  it('spreads APs that hear each other over different channels', () => {
    const gw = radio24([net(1, -60, { bssid: 'BB:00:00:00:00:01' })], {
      key: 'gw/radio0',
      channel: 6,
      bssids: ['AA:00:00:00:00:01'],
    });
    const ap = radio24([net(6, -50, { bssid: 'AA:00:00:00:00:01' })], {
      key: 'ap/radio0',
      channel: 6,
      bssids: ['BB:00:00:00:00:01'],
    });
    const [g, a] = recommendChannels([gw, ap]);
    const gwChannel = g.recommended ?? g.current;
    const apChannel = a.recommended ?? a.current;
    expect(gwChannel).not.toBe(apChannel);
  });

  it('suggests 20 MHz on a crowded 2.4 GHz band', () => {
    const scan = [net(1, -50), net(1, -55), net(1, -60), net(6, -50), net(6, -52), net(6, -58), net(11, -45), net(11, -50), net(11, -60)];
    const [advice] = recommendChannels([radio24(scan, { width: 40 })]);
    expect(advice.suggestWidth20).toBe(true);
  });

  it('leaves out DFS channels unless allowed', () => {
    const r: OwnRadio = {
      key: 'gw/radio1',
      band: '5G',
      channel: 36,
      width: 80,
      allowed: [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161],
      bssids: [],
      scan: [net(36, -40, { band: '5G', width: 80, center: 42 }), net(149, -38, { band: '5G', width: 80 })],
    };
    expect(recommendChannels([r])[0].recommended).toBeUndefined();
    const withDfs = recommendChannels([r], { allowDfs: true })[0];
    expect(withDfs.recommended).toBe(52);
    expect(withDfs.dfs).toBe(true);
  });
});

describe('scan parsing', () => {
  it('reads the announced width from a recorded scan', () => {
    const fixture = loadFixture('openwrt-24.10.8', 'iwinfo.scan.phy0-ap0');
    const scan = parseScan((fixture.ok ? (fixture.data as { results: [] }).results : []) ?? []);
    expect(scan.find((n) => n.ssid === 'RouteLink-5G')).toMatchObject({ band: '5G', channel: 36, width: 80, center: 42 });
    expect(scan.find((n) => n.ssid === 'Neighbor-Test')).toMatchObject({ band: '2.4G', channel: 11, width: 20 });
  });

  it('summarises channels', () => {
    const rows = channelTable('2.4G', [net(1, -50), net(1, -70), net(6, -40, { bssid: 'AA:00:00:00:00:01' })], ['aa:00:00:00:00:01'], [1, 6, 11]);
    expect(rows).toEqual([
      { channel: 1, networks: 2, strongest: -50, own: 0 },
      { channel: 6, networks: 1, strongest: -40, own: 1 },
      { channel: 11, networks: 0, strongest: undefined, own: 0 },
    ]);
  });

  it('reads widths from htmode', () => {
    expect(['HT20', 'VHT80', 'HE160', 'EHT320', 'NOHT', undefined].map(widthOfHtmode)).toEqual([20, 80, 160, 320, 20, 20]);
  });
});

describe('signal grades', () => {
  it('grades by dBm and drops a grade on a poor SNR', () => {
    expect([-50, -60, -61, -70, -75, -80, -81].map((s) => gradeSignal(s))).toEqual([
      'excellent',
      'excellent',
      'good',
      'good',
      'fair',
      'fair',
      'poor',
    ]);
    expect(gradeSignal(-58, -75)).toBe('good');
    expect(gradeSignal(-85, -90)).toBe('poor');
  });

  it('flags a link under half the usual rate', () => {
    expect(isRateLow('5G', { rx: 300_000, tx: 866_700 }, 80)).toBe(true);
    expect(isRateLow('5G', { rx: 600_000, tx: 866_700 }, 80)).toBe(false);
    expect(isRateLow('2.4G', { rx: 65_000 }, 20)).toBe(true);
    expect(isRateLow('2.4G', {})).toBe(false);
  });

  it('gives tips and bars', () => {
    expect(signalTips('fair', false)).toEqual(['move-closer', 'add-ap']);
    expect(signalTips('good', true)).toEqual(['rate-low']);
    expect([-50, -60, -70, -80, -90].map(signalBars)).toEqual([4, 3, 2, 1, 0]);
    expect(retryRate(10, 90)).toBe(10);
    expect(retryRate(undefined, 5)).toBeUndefined();
  });
});
