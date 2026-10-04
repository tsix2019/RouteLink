/**
 * routelinkd accuracy against real traffic: the plugin test router (scripts/agent-router.sh) with the
 * plugin installed (scripts/agent-dev-install.sh) and the traffic lab running (scripts/traffic-lab.sh).
 *
 * Ground truth is the lab client's eth0 counters minus 14 bytes of Ethernet header per packet, i.e. the
 * IP-level bytes that conntrack counts.
 */
import { execFileSync } from 'node:child_process';

import { nodeHttpClient } from '../../src/api/http/node';
import { UbusSession } from '../../src/api/ubus/session';

const ROUTER_URL = process.env.ROUTER_URL ?? 'http://127.0.0.1:18280';
const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const CLIENT = 'routelink-lab-client';
const SERVER4 = 'http://172.41.0.10:8080';
const SERVER6 = 'http://[fd41::10]:8080';
const MB = 1024 * 1024;

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (container: string, cmd: string) =>
  execFileSync('docker', ['exec', container, 'sh', '-c', cmd], { env, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const session = new UbusSession(
  { http: nodeHttpClient, baseUrl: ROUTER_URL },
  { username: 'root', password: process.env.ROUTER_PASSWORD ?? 'routelink-test' },
);
const call = <T>(method: string, params?: Record<string, unknown>) => session.call<T>('routelink', method, params);

interface Summary {
  start_exact: number;
  rx: number;
  tx: number;
  devices: { mac: string; rx: number; tx: number }[];
}
interface History {
  step: number;
  points: [number, number | null, number | null][];
}
interface Live {
  devices: { mac: string; rx_rate: number; tx_rate: number }[];
}

let mac = '';
const now = () => Math.floor(Date.now() / 1000);

function counters() {
  const [rx, rp, tx, tp] = sh(
    CLIENT,
    'd=/sys/class/net/eth0/statistics; echo $(cat $d/rx_bytes) $(cat $d/rx_packets) $(cat $d/tx_bytes) $(cat $d/tx_packets)',
  )
    .split(' ')
    .map(Number);
  return { rx: rx - 14 * rp, tx: tx - 14 * tp };
}

async function deviceBytes() {
  const t = now();
  const s = await call<Summary>('summary', { start: t - 3600, end: t + 60, class: 'all', limit: 500 });
  const d = s.devices.find((x) => x.mac === mac);
  return { rx: d?.rx ?? 0, tx: d?.tx ?? 0 };
}

/** Two fast samples, so closed and TIME_WAIT flows are counted. */
async function settle() {
  await call('live');
  await sleep(3000);
  await call('live');
}

async function measure(cmd: string) {
  await settle();
  const c0 = counters();
  const d0 = await deviceBytes();
  sh(CLIENT, cmd);
  await settle();
  const c1 = counters();
  const d1 = await deviceBytes();
  return { truthRx: c1.rx - c0.rx, gotRx: d1.rx - d0.rx, truthTx: c1.tx - c0.tx, gotTx: d1.tx - d0.tx };
}

const relErr = (got: number, truth: number) => Math.abs(got - truth) / truth;

beforeAll(async () => {
  mac = sh(CLIENT, 'cat /sys/class/net/eth0/address').toUpperCase();
  const info = await call<{ modules: string[]; conntrack_accounting: boolean }>('info');
  expect(info.modules).toContain('traffic');
  expect(info.conntrack_accounting).toBe(true);
});

describe('routelinkd accuracy', () => {
  it('counts a 100 MB download within 2%', async () => {
    const m = await measure(`curl -s -o /dev/null ${SERVER4}/${100 * MB}`);
    expect(m.truthRx).toBeGreaterThan(100 * MB);
    expect(relErr(m.gotRx, m.truthRx)).toBeLessThan(0.02);
  });

  it('misses none of 1000 short connections', async () => {
    const m = await measure(`seq 1 1000 | xargs -P 8 -I{} curl -s -o /dev/null ${SERVER4}/1024`);
    expect(relErr(m.gotRx, m.truthRx)).toBeLessThan(0.02);
    expect(relErr(m.gotTx, m.truthTx)).toBeLessThan(0.02);
  });

  it('attributes IPv6 traffic to the same device', async () => {
    const m = await measure(`curl -s -o /dev/null "${SERVER6}/${20 * MB}"`);
    expect(m.truthRx).toBeGreaterThan(20 * MB);
    expect(relErr(m.gotRx, m.truthRx)).toBeLessThan(0.02);
  });

  it('counts uploads as tx, not rx', async () => {
    const m = await measure(`head -c ${20 * MB} /dev/zero | curl -s -o /dev/null --data-binary @- ${SERVER4}/up`);
    expect(relErr(m.gotTx, m.truthTx)).toBeLessThan(0.02);
    expect(m.gotRx).toBeLessThan(m.gotTx / 50);
  });

  it('reports the live rate of a steady download within 15%', async () => {
    const rate = 2_000_000;
    sh(CLIENT, `(curl -s -o /dev/null --limit-rate ${rate} ${SERVER4}/${200 * MB} &) ; true`);
    try {
      await call('live');
      await sleep(5000);
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        await sleep(2100);
        const live = await call<Live>('live');
        samples.push(live.devices.find((d) => d.mac === mac)?.rx_rate ?? 0);
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(relErr(avg, rate)).toBeLessThan(0.15);
    } finally {
      sh(CLIENT, 'pkill curl; true');
    }
  });

  it('history over the last hour adds up to the summary', async () => {
    await settle();
    const end = now();
    const start = Math.floor(end / 60) * 60 - 3600;
    const h = await call<History>('history', { mac, start, end, class: 'all' });
    const s = await call<Summary>('summary', { start, end, class: 'all', limit: 500 });
    const fromHistory = h.points.reduce((sum, p) => sum + (p[1] ?? 0), 0);
    expect(s.start_exact).toBe(start);
    expect(fromHistory).toBe(s.devices.find((d) => d.mac === mac)?.rx ?? 0);
  });

  it('keeps written data across a daemon restart', async () => {
    await settle();
    const before = await deviceBytes();
    sh(ROUTER, '/etc/init.d/routelink restart; sleep 3');
    const after = await deviceBytes();
    expect(after.rx).toBe(before.rx);
    expect(after.tx).toBe(before.tx);
  });

  it('counts software-offloaded flows (skipped when the kernel has no flowtables)', async () => {
    const out = sh(
      ROUTER,
      'uci set firewall.@defaults[0].flow_offloading=1 && uci commit firewall && fw4 reload 2>&1; true',
    );
    try {
      if (/error/i.test(out)) {
        console.warn('flow offloading unavailable on this kernel, skipped:', out.split('\n')[0]);
        return;
      }
      const m = await measure(`curl -s -o /dev/null ${SERVER4}/${100 * MB}`);
      expect(relErr(m.gotRx, m.truthRx)).toBeLessThan(0.02);
    } finally {
      sh(ROUTER, 'uci set firewall.@defaults[0].flow_offloading=0 && uci commit firewall && fw4 reload >/dev/null 2>&1; true');
    }
  });
});
