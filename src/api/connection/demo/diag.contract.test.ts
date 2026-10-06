/**
 * Contract for P3 (diagnostics): the demo router and its AP must serve every diagnostics screen. Add each
 * new service function here.
 */
import { agentEvents, getAgentStatus } from '../../services/agent';
import {
  agentLatency,
  agentOutages,
  routerSpeedHistory,
  routerSpeedRun,
  startRouterSpeedtest,
} from '../../services/agent-diag';
import { runTool } from '../../services/diag';
import { DemoApConnection, DemoConnection } from './connection';

const NOW = 1_800_000_000_000;
const now = NOW / 1000;

function demo() {
  let t = NOW;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const conn = new DemoConnection(2026, clock.now, 0);
  return { conn, ap: new DemoApConnection(conn), clock };
}

describe('demo plugin: latency and outages', () => {
  it('reports the P3 modules', async () => {
    await expect(getAgentStatus(demo().conn)).resolves.toMatchObject({
      info: { capabilities: expect.arrayContaining(['latency', 'speedtest']) },
    });
  });

  it('gives minute latency for a day, every target, with the recent redial as loss', async () => {
    const { conn } = demo();
    const h = await agentLatency(conn, { start: now - 86_400, end: now, maxPoints: 720 });
    expect(h.tier).toBe('minute');
    expect(h.targets.map((t) => t.ip)).toEqual(['203.0.113.1', '223.5.5.5', '119.29.29.29', '1.1.1.1']);
    expect(h.series[0].points.length).toBe(720);
    expect(h.series[0].points.some((p) => (p.loss ?? 0) > 50)).toBe(true);
    const gw = h.summary[0];
    expect(gw.sent).toBeGreaterThan(8000);
    expect(gw.avgMs).toBeGreaterThan(1);
    expect(gw.avgMs).toBeLessThan(5);
    const one = await agentLatency(conn, { start: now - 90 * 86_400, end: now, target: '1.1.1.1' });
    expect(one.tier).toBe('hour');
    expect(one.series).toHaveLength(1);
  });

  it('lists outages with causes and availability, and WAN events for the redial', async () => {
    const { conn } = demo();
    const day = await agentOutages(conn, { start: now - 86_400, end: now });
    expect(day.count).toBeGreaterThanOrEqual(1);
    expect(day.outages[0]).toMatchObject({ cause: 'redial', ongoing: false });
    expect(day.availability).toBeGreaterThan(99);
    expect(day.availability).toBeLessThan(100);
    const month = await agentOutages(conn, { start: now - 30 * 86_400, end: now });
    expect(month.count).toBeGreaterThan(day.count);
    const ev = await agentEvents(conn, { start: now - 86_400, end: now, types: ['wan_down', 'wan_up'] });
    expect(ev.events.map((e) => e.type)).toEqual(expect.arrayContaining(['wan_down', 'wan_up']));
  });
});

describe('demo plugin: router speed test', () => {
  it('runs through its phases and lands in the history', async () => {
    const { conn, clock } = demo();
    const before = await routerSpeedHistory(conn);
    expect(before.results).toHaveLength(3);
    const { id } = await startRouterSpeedtest(conn);
    await expect(startRouterSpeedtest(conn)).resolves.toEqual({ id, already: true });
    clock.advance(5_000);
    expect(await routerSpeedRun(conn, id)).toMatchObject({ running: true, phase: 'download' });
    clock.advance(20_000);
    const done = await routerSpeedRun(conn, id);
    expect(done).toMatchObject({ running: false, phase: 'done' });
    expect(done.result!.downBps! / 1e6).toBeGreaterThan(400);
    expect((await routerSpeedHistory(conn)).results[0].id).toBe(id);
  });
});

describe('demo diagnostics tools', () => {
  it('pings, traces and looks up on the gateway and the AP', async () => {
    const { conn, ap } = demo();
    const p = await runTool(conn, 'ping', '223.5.5.5', { count: 4 });
    expect(p.tool === 'ping' && p.summary).toMatchObject({ transmitted: 4, received: 4, lossPct: 0 });
    const fromAp = await runTool(ap, 'ping', '192.168.8.1', { count: 5 });
    expect(fromAp.tool === 'ping' && fromAp.summary.avg).toBeGreaterThan(1);
    const tr = await runTool(ap, 'traceroute', 'openwrt.org');
    expect(tr.tool === 'traceroute' && tr.summary[0].ip).toBe('192.168.8.1');
    const ns = await runTool(conn, 'nslookup', 'www.example.com');
    expect(ns.tool === 'nslookup' && ns.summary.answers).toHaveLength(1);
    const nx = await runTool(conn, 'nslookup', 'nope.invalid');
    expect(nx.tool === 'nslookup' && nx.summary.error).toBe('NXDOMAIN');
    const bad = await runTool(conn, 'ping', 'nope.invalid');
    expect(bad.tool === 'ping' && bad.summary.error).toContain('bad address');
  });
});
