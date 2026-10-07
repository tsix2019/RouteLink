/**
 * Contract for P4 (limits, quotas, DNS log, destinations, push): the demo router must serve every screen.
 * Add each new service function here.
 */
import { getAgentDevices, getAgentStatus } from '../../services/agent';
import {
  agentDestinations,
  agentDnsLog,
  agentQuotas,
  allowQuota,
  notifyStatus,
  testChannel,
} from '../../services/agent-control';
import { applyRules, channelChanges, dnsChanges, getRules, limitChanges } from '../../services/agent-rules';
import { uci } from '../../uci';
import { DemoConnection } from './connection';
import { periodOf } from './control';

const NOW = 1_800_000_000_000;
const now = NOW / 1000;

function demo() {
  let t = NOW;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  return { conn: new DemoConnection(2026, clock.now, 0), clock };
}

describe('demo plugin: rules', () => {
  it('starts with a limit, two quotas, DNS logging and a push channel', async () => {
    const { conn } = demo();
    const r = await getRules(conn);
    expect(r.limits).toHaveLength(1);
    expect(r.limits[0]).toMatchObject({
      download: 4000,
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start: '19:00',
    });
    expect(r.quotas.map((q) => q.period)).toEqual(['month', 'week']);
    expect(r.dns.enabled).toBe(true);
    expect(r.channels[0]).toMatchObject({ type: 'bark', name: 'iPhone' });
    await expect(getAgentStatus(conn)).resolves.toMatchObject({ info: { limitsError: '', dnsEnabled: true } });
  });

  it('saves edits through UCI', async () => {
    const { conn } = demo();
    const pixel = (await getAgentDevices(conn)).find((d) => d.hostname === 'Pixel-9')!;
    await applyRules(conn, limitChanges({ mac: pixel.mac, enabled: true, download: 2000, upload: 500, weekdays: [] }));
    expect((await getRules(conn)).limits.map((l) => l.mac)).toContain(pixel.mac);
    await applyRules(
      conn,
      dnsChanges(await uci.get(conn, 'routelink'), { enabled: false, keepDays: 7, maxRecords: 1000 }),
    );
    expect((await getRules(conn)).dns.enabled).toBe(false);
    await expect(agentDnsLog(conn, { start: now - 3600, end: now })).resolves.toEqual({ count: 0, records: [] });
  });
});

describe('demo plugin: quotas', () => {
  it('reports usage from the traffic model and lets a device through for an hour', async () => {
    const { conn } = demo();
    const q = await agentQuotas(conn);
    expect(q).toHaveLength(2);
    for (const x of q) {
      expect(x.used).toBeGreaterThan(0);
      expect(x.periodStart).toBeLessThanOrEqual(now);
      expect(x.periodEnd).toBeGreaterThan(now);
    }
    await allowQuota(conn, q[1].section, 'hour');
    const after = await agentQuotas(conn);
    expect(after[1]).toMatchObject({ state: 'allowed', allowUntil: now + 3600 });
  });

  it('computes periods in local time', () => {
    // 2027-01-15 07:00 UTC = 15:00 in Shanghai, a Friday.
    const t = Date.UTC(2027, 0, 15, 7) / 1000;
    expect(periodOf(t, 'month', 1).map((x) => new Date((x + 8 * 3600) * 1000).toISOString().slice(0, 10))).toEqual([
      '2027-01-01',
      '2027-02-01',
    ]);
    expect(periodOf(t, 'month', 20).map((x) => new Date((x + 8 * 3600) * 1000).toISOString().slice(0, 10))).toEqual([
      '2026-12-20',
      '2027-01-20',
    ]);
    expect(new Date((periodOf(t, 'week', 1)[0] + 8 * 3600) * 1000).toISOString().slice(0, 10)).toBe('2027-01-11');
  });
});

describe('demo plugin: destinations and DNS', () => {
  it('ranks destinations of a device and searches its lookups', async () => {
    const { conn } = demo();
    const tv = (await getAgentDevices(conn)).find((d) => d.hostname === 'Living-Room-TV')!;
    const dest = await agentDestinations(conn, { mac: tv.mac, start: now - 86_400, end: now });
    expect(dest.length).toBeGreaterThan(3);
    expect(dest[0].host).toBeDefined();
    const order = dest.map((d) => d.rx + d.tx);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    const log = await agentDnsLog(conn, { mac: tv.mac, start: now - 86_400, end: now, limit: 20 });
    expect(log.records).toHaveLength(20);
    expect(log.records.every((r) => r.mac === tv.mac)).toBe(true);
    const found = await agentDnsLog(conn, { start: now - 86_400, end: now, q: 'bilivideo' });
    expect(found.count).toBeGreaterThan(0);
    expect(found.records.every((r) => r.name.includes('bilivideo'))).toBe(true);
  });
});

describe('demo plugin: push', () => {
  it('sends a test message and reports a failing channel', async () => {
    const { conn } = demo();
    const [bark] = (await getRules(conn)).channels;
    await expect(testChannel(conn, bark.section!)).resolves.toEqual({ ok: true, error: undefined });
    await applyRules(
      conn,
      channelChanges({
        type: 'webhook',
        enabled: true,
        name: 'Broken',
        url: 'https://fail.invalid/hook',
        template: '',
        token: '',
        chatId: '',
        secret: '',
        events: ['outage'],
      }),
    );
    const broken = (await getRules(conn)).channels.find((c) => c.name === 'Broken')!;
    await expect(testChannel(conn, broken.section!)).resolves.toEqual({ ok: false, error: 'HTTP 404' });
    const status = await notifyStatus(conn);
    expect(status.channels.find((c) => c.section === broken.section)).toMatchObject({ lastError: 'HTTP 404' });
  });
});
