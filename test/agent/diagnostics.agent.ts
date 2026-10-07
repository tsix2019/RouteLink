/**
 * P3 T5, latency probes, the outage log and the router-side speed test against the traffic lab: the probe
 * target is the lab's "internet" server, the speed test runs against its LibreSpeed-style endpoints
 * (garbage.php, empty.php). Needs the plugin test router with the plugin installed and the traffic lab
 * (scripts/agent-router.sh, scripts/agent-dev-install.sh, scripts/traffic-lab.sh).
 *
 * Another router instance (RL_AGENT_NAME / RL_AGENT_NET / RL_AGENT_PORT in the scripts): set ROUTER_URL,
 * ROUTER_CONTAINER, LAB_SERVER and LAB_SERVER_IP.
 */
import { execFileSync } from 'node:child_process';

import { nodeHttpClient } from '../../src/api/http/node';
import { UbusSession } from '../../src/api/ubus/session';
import { answeredProbes, waitForProbes } from './lab-probes';

const ROUTER_URL = process.env.ROUTER_URL ?? 'http://127.0.0.1:18280';
const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const SERVER = process.env.LAB_SERVER ?? 'routelink-lab-server';
const SERVER_IP = process.env.LAB_SERVER_IP ?? '172.41.0.10';
/** The router's WAN address and Docker's gateway on the WAN network (the next hop). */
const ROUTER_WAN_IP = SERVER_IP.replace(/\.\d+$/, '.2');
const NEXT_HOP = SERVER_IP.replace(/\.\d+$/, '.1');
const CUT_SECONDS = 40;

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (container: string, cmd: string) =>
  execFileSync('docker', ['exec', container, 'sh', '-c', cmd], { env, encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const session = new UbusSession(
  { http: nodeHttpClient, baseUrl: ROUTER_URL },
  { username: 'root', password: process.env.ROUTER_PASSWORD ?? 'routelink-test' },
);
const call = <T>(method: string, params?: Record<string, unknown>) => session.call<T>('routelink', method, params);

interface Latency {
  step: number;
  tier: string;
  targets: { id: number; ip: string; kind: 'gateway' | 'custom' }[];
  series: { target: number; points: [number, number | null, number | null, number | null][] }[];
  summary: { target: number; sent: number; lost: number; avg_ms: number | null; max_ms: number | null }[];
}
interface Outages {
  count: number;
  total_sec: number;
  availability: number | null;
  outages: { start: number; end: number; duration: number; cause: string; ongoing: boolean }[];
}
interface SpeedRun {
  id: number;
  running: boolean;
  phase: string;
  progress: number;
  error?: string;
  result?: {
    id: number;
    latency_ms: number | null;
    jitter_ms: number | null;
    down_bps: number | null;
    up_bps: number | null;
    error?: string;
  };
}

/** Polls fn every second until it returns something, at most `seconds`. */
async function waitFor<T>(what: string, seconds: number, fn: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const v = await fn();
    if (v !== undefined) return v;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function serverSummary() {
  const t = now();
  const l = await call<Latency>('latency', { start: t - 600, end: t + 60 });
  const target = l.targets.find((x) => x.ip === SERVER_IP && x.kind === 'custom');
  return { l, target, summary: l.summary.find((s) => s.target === target?.id) };
}

/** The outages that began at or after t0, once none of them is ongoing any more. */
async function finishedOutages(t0: number) {
  return waitFor('the outage to end', 60, async () => {
    const o = await call<Outages>('outages', { start: t0, end: now() + 60 });
    return o.count && !o.outages.some((x) => x.ongoing) ? o : undefined;
  });
}

let savedTargets = '';
let started = 0;

beforeAll(async () => {
  const info = await call<{ modules: string[]; capabilities: string[] }>('info');
  expect(info.capabilities).toEqual(expect.arrayContaining(['latency', 'speedtest']));
  expect(info.modules).toEqual(expect.arrayContaining(['latency', 'speedtest']));
  savedTargets = sh(ROUTER, 'uci -q get routelink.probe.target || true');
  const from = now() - 600;
  const before = await answeredProbes(call, SERVER_IP, from);
  sh(
    ROUTER,
    `uci -q delete routelink.probe.target; uci set routelink.probe=probe; uci set routelink.probe.enabled=1; ` +
      `uci set routelink.probe.gateway=1; uci add_list routelink.probe.target=${SERVER_IP}; ` +
      `uci commit routelink; reload_config`,
  );
  // A few rounds (10 s apart) answered since the switch, not the ones an earlier suite got (control.agent.ts
  // probes the lab server too); and an outage the default targets began (CI runners drop ICMP to the
  // internet) has to be over before the tests below count theirs.
  await waitForProbes(call, SERVER_IP, from, before + 3);
  started = now();
});

afterAll(() => {
  sh(ROUTER, 'ifup wan; true');
  sh(SERVER, `ip route del blackhole ${ROUTER_WAN_IP}/32 2>/dev/null; true`);
  const restore = savedTargets
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `uci add_list routelink.probe.target=${t}; `)
    .join('');
  sh(ROUTER, `uci -q delete routelink.probe.target; ${restore}uci commit routelink; reload_config`);
});

describe('routelinkd diagnostics', () => {
  it('measures the latency to the lab server and to the next hop', async () => {
    const { l, target, summary } = await serverSummary();
    expect(l.tier).toBe('minute');
    expect(l.step).toBe(60);
    expect(target).toBeDefined();
    expect(summary!.sent - summary!.lost).toBeGreaterThanOrEqual(3); /* losses: an earlier run's outages */
    expect(summary!.avg_ms).toBeLessThan(50);
    expect(summary!.max_ms).toBeGreaterThanOrEqual(summary!.avg_ms!);
    const gw = l.targets.find((x) => x.kind === 'gateway');
    expect(gw?.ip).toBe(NEXT_HOP);
    const points = l.series.find((s) => s.target === target!.id)!.points;
    expect(points.some(([, avg, , loss]) => avg !== null && loss === 0)).toBe(true);
    // one target only; unknown targets and bad sizes are refused
    const t = now();
    const one = await call<Latency>('latency', { start: t - 600, end: t, target: SERVER_IP, max_points: 5 });
    expect(one.targets).toEqual([{ id: target!.id, ip: SERVER_IP, kind: 'custom' }]);
    expect(one.series[0].points.length).toBeLessThanOrEqual(5);
    await expect(call('latency', { start: t - 600, end: t, target: '192.0.2.99' })).rejects.toThrow();
    await expect(call('latency', { start: t - 600, end: t, max_points: 1001 })).rejects.toThrow();
  });

  it(`records one redial outage when the WAN goes down for ${CUT_SECONDS} s`, async () => {
    const t0 = now();
    sh(ROUTER, 'ifdown wan');
    try {
      await sleep(CUT_SECONDS * 1000);
    } finally {
      sh(ROUTER, 'ifup wan');
    }
    const o = await finishedOutages(t0);
    expect(o.count).toBe(1);
    const [outage] = o.outages;
    // down within 60 s and up again: a reconnect (core/probe), like a PPPoE redial
    expect(outage.cause).toBe('redial');
    expect(outage.duration).toBeGreaterThanOrEqual(CUT_SECONDS - 20);
    expect(outage.duration).toBeLessThanOrEqual(CUT_SECONDS + 20);
    const ev = await call<{ events: { ts: number; type: string }[] }>('events', {
      start: t0,
      end: now() + 1,
      types: ['wan_down', 'wan_up'],
    });
    expect(ev.events.map((e) => e.type)).toEqual(['wan_up', 'wan_down']); // newest first, one of each
    // the next hop was cut off too
    const l = await call<Latency>('latency', { start: t0, end: now(), target: NEXT_HOP });
    expect(l.summary[0].lost).toBeGreaterThan(0);
  });

  it(`records an upstream outage when only the internet side fails for ${CUT_SECONDS} s`, async () => {
    const t0 = now();
    sh(SERVER, `ip route add blackhole ${ROUTER_WAN_IP}/32`);
    try {
      await sleep(CUT_SECONDS * 1000);
    } finally {
      sh(SERVER, `ip route del blackhole ${ROUTER_WAN_IP}/32`);
    }
    const o = await finishedOutages(t0);
    expect(o.count).toBe(1);
    expect(o.outages[0].cause).toBe('upstream');
    expect(o.outages[0].duration).toBeGreaterThanOrEqual(CUT_SECONDS - 20);
    // the next hop kept answering (from the first whole minute: the one before may still hold the WAN cut,
    // and that minute has to have begun, with a probe round or two in it)
    const whole = Math.ceil(t0 / 60) * 60;
    while (now() < whole + 25) await sleep(1000);
    const l = await call<Latency>('latency', { start: t0, end: now(), target: NEXT_HOP });
    const after = l.series[0].points.filter(([ts]) => ts >= whole);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(([, , , loss]) => loss === null || loss === 0)).toBe(true);
    // both outages count against the availability since the test began
    const all = await call<Outages>('outages', { start: started, end: now() });
    expect(all.count).toBe(2);
    expect(all.availability).toBeGreaterThan(0);
    expect(all.availability).toBeLessThan(100);
  });

  it('measures the speed against the lab LibreSpeed endpoints', async () => {
    const server = `http://${SERVER_IP}:8080/`;
    const { id } = await call<{ id: number }>('speedtest_start', { server });
    const again = await call<{ id: number; already?: boolean }>('speedtest_start', { server });
    expect(again).toEqual({ id, already: true });
    await expect(call('speedtest_start', { server: 'ftp://example.com/' })).rejects.toThrow();
    const run = await waitFor('the speed test', 120, async () => {
      const r = await call<SpeedRun>('speedtest_status', { id });
      return r.running ? undefined : r;
    });
    expect(run.error).toBeUndefined();
    expect(run.phase).toBe('done');
    const r = run.result!;
    expect(r.latency_ms).toBeLessThan(20);
    // a Docker bridge and a Python server: well above any real line, well below silly values
    expect(r.down_bps).toBeGreaterThan(50e6);
    expect(r.down_bps).toBeLessThan(100e9);
    expect(r.up_bps).toBeGreaterThan(10e6);
    expect(r.up_bps).toBeLessThan(100e9);
    const history = await call<{ running: boolean; results: { id: number }[] }>('speedtest_status', {});
    expect(history.running).toBe(false);
    expect(history.results[0].id).toBe(id);
  });
});
