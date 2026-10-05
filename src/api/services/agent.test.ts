import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import { UbusError } from '../ubus/errors';
import type { UbusResult } from '../ubus/types';
import {
  AGENT_API,
  agentEvents,
  agentHistory,
  agentLive,
  agentSummary,
  getAgentDevices,
  getAgentInfo,
  getAgentStatus,
  parseDevices,
  parseHistory,
  parseInfo,
  parseSummary,
} from './agent';

// Recorded from routelinkd 0.1.0 on the plugin test router (scripts/agent-router.sh + traffic-lab.sh).
const recorded = () => new FixtureConnection('agent-24.10');
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const now = 1_791_171_948;

describe('plugin client on recorded responses', () => {
  it('reads info', async () => {
    const info = await getAgentInfo(recorded());
    expect(info).toMatchObject({ version: '0.1.0', api: 1, roles: ['gateway'], offload: 'none' });
    expect(info.conntrackAccounting).toBe(true);
    expect(info.retention.minuteHours).toBeGreaterThan(0);
    expect(info.storage.limitBytes).toBeGreaterThan(info.storage.usedBytes);
  });

  it('reads devices with today usage and rates in bits per second', async () => {
    const devices = await getAgentDevices(recorded());
    expect(devices.length).toBeGreaterThan(0);
    for (const d of devices) {
      expect(d.mac).toMatch(MAC);
      expect(d.rate.rxBps).toBeGreaterThanOrEqual(0);
      expect(d.today.rx).toBeGreaterThanOrEqual(0);
    }
    const client = devices.find((d) => d.ipv4.includes('172.40.0.10'))!;
    expect(client.today.rx).toBeGreaterThan(100_000_000);
    expect(client.rate.rxBps % 8).toBe(0);
    expect(client.name).toBeUndefined(); // empty strings become undefined
  });

  it('reads live rates, busiest first', async () => {
    const live = await agentLive(recorded());
    expect(live.intervalSec).toBe(2);
    expect(live.leaseUntil).toBeGreaterThan(live.ts);
    expect(live.wan.rxBps).toBeGreaterThan(1_000_000);
    const totals = live.devices.map((d) => d.rxBps + d.txBps);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('reads history with gaps as null', async () => {
    const h = await agentHistory(recorded(), { start: now - 3600, end: now });
    expect(h.tier).toBe('minute');
    expect(h.step).toBe(60);
    expect(h.points.length).toBeGreaterThan(50);
    const wan = await agentHistory(recorded(), { start: now - 86400, end: now, cls: 'wan' });
    expect(wan.points.some((p) => p.rx === null)).toBe(true);
    expect(wan.points.some((p) => (p.rx ?? 0) > 0)).toBe(true);
  });

  it('sends only the parameters that are set', async () => {
    const conn = recorded();
    await agentHistory(conn, { start: 1, end: 2, cls: 'wan', hoursMask: 0b111, maxPoints: 100 });
    await agentSummary(conn, { start: 1, end: 2 });
    await agentEvents(conn, { start: 1, end: 2, mac: 'AA:BB:CC:00:11:22', types: ['device_online'] });
    expect(conn.calls.map((c) => c.params)).toEqual([
      { start: 1, end: 2, class: 'wan', hours: 7, max_points: 100 },
      { start: 1, end: 2 },
      { start: 1, end: 2, mac: 'AA:BB:CC:00:11:22', types: ['device_online'] },
    ]);
  });

  it('reads the summary', async () => {
    const s = await agentSummary(recorded(), { start: now - 86400, end: now });
    expect(s.count).toBe(s.devices.length);
    expect(s.devices.reduce((sum, d) => sum + d.rx, 0)).toBe(s.rx);
    expect(s.wanRx).toBeGreaterThanOrEqual(s.rx);
    expect(s.truncated).toBe(false);
  });

  it('reads events', async () => {
    const e = await agentEvents(recorded(), { start: now - 86400, end: now });
    expect(e.count).toBe(e.events.length);
    expect(e.events.map((x) => x.type)).toContain('device_new');
    expect(e.events.filter((x) => x.mac).every((x) => MAC.test(x.mac!))).toBe(true);
  });

  it('treats a device the plugin never saw as having no history', async () => {
    const conn = recorded().override('routelink.history.device', fail('NOT_FOUND'));
    await expect(agentHistory(conn, { start: 1, end: 2, mac: 'AA:BB:CC:00:11:22' })).resolves.toMatchObject({
      points: [],
    });
    await expect(
      agentHistory(recorded().override('routelink.history', fail('NOT_FOUND')), { start: 1, end: 2 }),
    ).rejects.toBeInstanceOf(UbusError);
  });
});

describe('parsing odd responses', () => {
  it('falls back to safe defaults for missing fields', () => {
    expect(parseInfo({})).toMatchObject({ version: '?', api: 0, roles: [], offload: 'none', conntrackAccounting: true });
    expect(parseDevices({ devices: [{ mac: 'aa-bb-cc-00-11-22' }, null] })).toEqual([
      expect.objectContaining({ mac: 'AA:BB:CC:00:11:22', ipv4: [], online: false, rate: { rxBps: 0, txBps: 0 } }),
      expect.objectContaining({ mac: '', today: { rx: 0, tx: 0 } }),
    ]);
    expect(parseDevices(null)).toEqual([]);
  });

  it('keeps null points and drops malformed ones', () => {
    expect(parseHistory({ step: 60, tier: 'hour', points: [[60, null, 5], 'x', [], [120, 1, 'y']] }).points).toEqual([
      { t: 60, rx: null, tx: 5 },
      { t: 120, rx: 1, tx: null },
    ]);
    expect(parseHistory({ tier: 'decade' }).tier).toBe('minute');
  });

  it('flags truncated summaries', () => {
    expect(parseSummary({ truncated: true, devices: [{ mac: 'AA:BB:CC:00:11:22', rx: 1 }] })).toMatchObject({
      truncated: true,
      count: 1,
      devices: [{ mac: 'AA:BB:CC:00:11:22', rx: 1, tx: 0 }],
    });
  });
});

describe('getAgentStatus', () => {
  const info = (api: number) => ok({ version: '9.9.9', api });
  const status = (infoResult: UbusResult, statResult: UbusResult = ok({ type: 'file' })) =>
    getAgentStatus(new FixtureConnection().override('routelink.info', infoResult).override('file.stat', statResult));

  it('is ok when the API version is in range', async () => {
    await expect(status(info(AGENT_API.min))).resolves.toMatchObject({ state: 'ok', info: { version: '9.9.9' } });
  });

  it('tells which side to upgrade', async () => {
    await expect(status(info(AGENT_API.min - 1))).resolves.toMatchObject({ state: 'too-old' });
    await expect(status(info(AGENT_API.max + 1))).resolves.toMatchObject({ state: 'too-new' });
  });

  it('is not running when the object is missing but the binary exists', async () => {
    await expect(status(fail('NOT_FOUND'))).resolves.toEqual({ state: 'not-running' });
    await expect(status(fail('METHOD_NOT_FOUND'))).resolves.toEqual({ state: 'not-running' });
  });

  it('is not installed without the binary, whether the call was denied or not found', async () => {
    await expect(status(fail('NOT_FOUND'), fail('NOT_FOUND'))).resolves.toEqual({ state: 'not-installed' });
    // No package, no ACL: rpcd denies the call before it looks for the object.
    await expect(status(fail('PERMISSION_DENIED'), fail('NOT_FOUND'))).resolves.toEqual({ state: 'not-installed' });
  });

  it('reports missing permission when the binary exists (or cannot be checked)', async () => {
    await expect(status(fail('PERMISSION_DENIED'))).resolves.toEqual({ state: 'no-permission' });
    await expect(status(fail('PERMISSION_DENIED'), fail('PERMISSION_DENIED'))).resolves.toEqual({
      state: 'no-permission',
    });
  });

  it('passes other failures on', async () => {
    await expect(status(fail('TIMEOUT'))).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('works on the recorded router', async () => {
    await expect(getAgentStatus(recorded())).resolves.toMatchObject({ state: 'ok' });
  });
});
