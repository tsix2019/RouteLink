import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { getDeviceCounters, getInterfaces, pickWan, reconnectInterface } from './network';
import { demoRateHistory } from '../connection/demo/history';
import { RateTracker } from './traffic';

describe('getInterfaces (OpenWrt 24.10 fixture)', () => {
  it('parses lan and wan, skipping loopback', async () => {
    const ifs = await getInterfaces(new FixtureConnection());
    expect(ifs.map((i) => i.name).sort()).toEqual(['lan', 'wan']);
    const lan = ifs.find((i) => i.name === 'lan')!;
    expect(lan.ipv4).toEqual([{ address: '172.30.0.2', mask: 24 }]);
    expect(lan.up).toBe(true);
    const wan = ifs.find((i) => i.name === 'wan')!;
    expect(wan.gateway).toBe('172.31.0.1');
    expect(wan.dns).toEqual(['1.1.1.1']);
    expect(wan.device).toBe('eth1');
    expect(wan.hasDefaultRoute).toBe(true);
  });

  it('reports down interfaces with zero uptime', async () => {
    const conn = new FixtureConnection().override(
      'network.interface.dump',
      ok({
        interface: [{ interface: 'wan', up: false, uptime: 99, proto: 'pppoe', errors: [{ code: 'AUTH_FAILED' }] }],
      }),
    );
    const [wan] = await getInterfaces(conn);
    expect(wan.uptimeSec).toBe(0);
    expect(wan.errors).toEqual(['AUTH_FAILED']);
  });
});

describe('pickWan', () => {
  const base = { proto: 'static', up: true, available: true, uptimeSec: 1, ipv4: [], ipv6: [], dns: [], errors: [] };
  it('prefers the interface named wan', () => {
    expect(
      pickWan([
        { ...base, name: 'lan', hasDefaultRoute: true },
        { ...base, name: 'wan', hasDefaultRoute: false },
      ])?.name,
    ).toBe('wan');
  });
  it('falls back to the default route holder', () => {
    expect(
      pickWan([
        { ...base, name: 'lan', hasDefaultRoute: false },
        { ...base, name: 'pppoe', hasDefaultRoute: true },
      ])?.name,
    ).toBe('pppoe');
  });
});

it('reads device byte counters', async () => {
  const counters = await getDeviceCounters(new FixtureConnection());
  expect(counters.eth1.rx).toBeGreaterThan(0);
  expect(counters.eth1.up).toBe(true);
  expect(counters.eth1.speedMbps).toBe(10000);
});

it('reconnects an interface with ifdown + ifup and rejects odd names', async () => {
  const conn = new FixtureConnection()
    .override('file.exec.sbin-ifdown-wan', ok({ code: 0 }))
    .override('file.exec.sbin-ifup-wan', ok({ code: 0 }));
  await reconnectInterface(conn, 'wan');
  expect(conn.calls.map((c) => (c.params as { command: string }).command)).toEqual(['/sbin/ifdown', '/sbin/ifup']);
  await expect(reconnectInterface(conn, 'wan; reboot')).rejects.toThrow(/invalid/);
});

describe('RateTracker', () => {
  it('needs two samples for a rate', () => {
    const t = new RateTracker();
    expect(t.push(0, 0, 0)).toBeNull();
    expect(t.push(2000, 250_000, 125_000)).toEqual({ t: 2000, rxBps: 1_000_000, txBps: 500_000 });
  });

  it('drops samples after a counter reset', () => {
    const t = new RateTracker();
    t.push(0, 1000, 1000);
    expect(t.push(1000, 10, 10)).toBeNull();
    expect(t.push(2000, 135, 10)).toEqual({ t: 2000, rxBps: 1000, txBps: 0 });
    expect(t.series).toHaveLength(1);
  });

  it('keeps at most `capacity` points', () => {
    const t = new RateTracker(3);
    for (let i = 0; i <= 10; i++) t.push(i * 1000, i * 100, 0);
    expect(t.series).toHaveLength(3);
    expect(t.latest?.t).toBe(10_000);
  });

  it('seeds an empty tracker only, within capacity', () => {
    const t = new RateTracker(3);
    const history = demoRateHistory(5, 2000, 10_000);
    t.seed(history);
    expect(t.series.map((p) => p.t)).toEqual([6000, 8000, 10_000]);
    t.seed(demoRateHistory(5, 2000, 99_000));
    expect(t.latest?.t).toBe(10_000);
  });
});

describe('demoRateHistory', () => {
  it('is reproducible, evenly spaced and in a believable range', () => {
    const a = demoRateHistory(60, 2000, 120_000);
    expect(a).toEqual(demoRateHistory(60, 2000, 120_000));
    expect(a[59].t - a[0].t).toBe(59 * 2000);
    for (const p of a) {
      expect(p.rxBps).toBeGreaterThan(1_000_000);
      expect(p.rxBps).toBeLessThan(200_000_000);
      expect(p.txBps).toBeGreaterThan(100_000);
    }
  });
});
