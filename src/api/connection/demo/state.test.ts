import { createDemoState, tick } from './state';

it('is deterministic for a seed', () => {
  const a = createDemoState(7, 1_000);
  const b = createDemoState(7, 1_000);
  expect(a.devices).toEqual(b.devices);
  expect(a.uci).toEqual(b.uci);
  expect(a.syslog).toEqual(b.syslog);
});

it('has fifteen devices with offline, static and blocked examples', () => {
  const s = createDemoState();
  expect(s.devices).toHaveLength(15);
  expect(s.devices.filter((d) => !d.online)).toHaveLength(2);
  expect(s.devices.filter((d) => d.kind === 'wifi')).toHaveLength(10);
  expect(Object.values(s.uci.dhcp).filter((x) => x['.type'] === 'host')).toHaveLength(1);
  expect(Object.values(s.uci.firewall).some((r) => String(r.name).startsWith('RouteLink: block'))).toBe(true);
});

it('advances counters monotonically and keeps rates in range', () => {
  const s = createDemoState(1, 0);
  let last = { ...s.counters['pppoe-wan'] };
  for (let t = 2000; t <= 120_000; t += 2000) {
    tick(s, t);
    const now = s.counters['pppoe-wan'];
    expect(now.rx).toBeGreaterThan(last.rx);
    expect(now.tx).toBeGreaterThan(last.tx);
    expect(s.wanRate.rx).toBeLessThanOrEqual(20_000_000);
    last = { ...now };
  }
});
