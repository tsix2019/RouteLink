/**
 * P4 T11: quotas, the DNS log, destinations and push messages against the traffic lab.
 *
 * - Push: a webhook channel pointing at the lab server's receiver (scripts/traffic-lab.sh, /hook…) gets the
 *   test message and later the quota notice; a failing channel reports its error.
 * - DNS: lookups the lab client sends to the lab server's DNS responder (through the router) show up in
 *   `dns`; the name then labels the server in `destinations`.
 * - Quota: a device that uses up its quota loses the internet, an established (software-offloaded where the
 *   kernel has flowtables) connection included (design §21 ④), keeps the LAN, and comes back with
 *   quota_allow.
 *
 * Needs the plugin test router with the plugin installed and the traffic lab. Another router instance
 * (RL_AGENT_NAME / RL_AGENT_NET / RL_AGENT_PORT in the scripts): set ROUTER_URL, ROUTER_CONTAINER,
 * LAB_CLIENT, LAB_SERVER and LAB_SERVER_IP.
 */
import { execFileSync } from 'node:child_process';

import { nodeHttpClient } from '../../src/api/http/node';
import { UbusSession } from '../../src/api/ubus/session';
import { answeredProbes, waitForProbes } from './lab-probes';

const ROUTER_URL = process.env.ROUTER_URL ?? 'http://127.0.0.1:18280';
const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const CLIENT = process.env.LAB_CLIENT ?? 'routelink-lab-client';
const SERVER = process.env.LAB_SERVER ?? 'routelink-lab-server';
const SERVER_IP = process.env.LAB_SERVER_IP ?? '172.41.0.10';
/** The router's LAN address: the lab's LAN is the network below the WAN (172.40 / 172.41). */
const ROUTER_LAN_IP = `172.${Number(SERVER_IP.split('.')[1]) - 1}.0.2`;
const RUN = Date.now().toString(36);

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (container: string, cmd: string) =>
  execFileSync('docker', ['exec', container, 'sh', '-c', cmd], { env, encoding: 'utf8' }).trim();
const ok = (container: string, cmd: string) => {
  try {
    sh(container, cmd);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const session = new UbusSession(
  { http: nodeHttpClient, baseUrl: ROUTER_URL },
  { username: 'root', password: process.env.ROUTER_PASSWORD ?? 'routelink-test' },
);
const call = <T>(method: string, params?: Record<string, unknown>) => session.call<T>('routelink', method, params);

interface Info {
  capabilities: string[];
  modules: string[];
  dns_enabled: boolean;
  limits_error: string;
}
interface Quota {
  section: string;
  mac: string;
  period: string;
  period_start: number;
  period_end: number;
  limit: number;
  used: number;
  pct: number;
  state: 'ok' | 'warned' | 'exceeded' | 'allowed';
  allow_until: number;
  action: 'block' | 'limit';
}
interface DnsRecord {
  ts: number;
  mac: string;
  name: string;
  type: string;
  rcode: string;
  answers: string[];
}
interface Hook {
  path: string;
  type: string;
  body: string;
}

/** Polls fn every second until it returns something, at most `seconds`. */
async function waitFor<T>(what: string, seconds: number, fn: () => Promise<T | undefined> | T | undefined): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const v = await fn();
    if (v !== undefined) return v;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** What the lab server's webhook receiver got for this run. */
const hooks = (): Hook[] =>
  (JSON.parse(sh(SERVER, 'wget -qO- http://127.0.0.1:8080/hook')) as Hook[]).filter((h) => h.path.includes(RUN));

const uci = (cmds: string) => sh(ROUTER, `${cmds}; uci commit routelink; reload_config`);
const quotaOf = async (mac: string) => (await call<{ quotas: Quota[] }>('quotas')).quotas.find((q) => q.mac === mac);
/** Sections of the push channels the daemon has loaded. */
const channels = async () =>
  (await call<{ channels: { section: string }[] }>('notify_status')).channels.map((c) => c.section);
const TEST_CHANNELS = ['rltest', 'rlfail'];
/** The client reaches the internet (the lab server) within 5 s. */
const online = () => ok(CLIENT, `curl -s -m 5 -o /dev/null http://${SERVER_IP}:8080/10`);

let mac = '';
let supported = false;
let savedTargets = '';

beforeAll(async () => {
  mac = sh(CLIENT, 'cat /sys/class/net/eth0/address').toUpperCase();
  const info = await call<Info>('info');
  supported = info.capabilities.includes('quotas') && info.capabilities.includes('notify');
  if (!supported) return;
  // the device must be known to the daemon (destinations refuse unknown MACs)
  sh(CLIENT, `curl -s -o /dev/null http://${SERVER_IP}:8080/1000`);
  // CI runners drop ICMP to the internet: with the default probe targets the daemon sees an outage, and
  // push messages wait for it to end. Probe the lab server instead, until an answer ended any such outage
  // (an earlier suite may have restored the default targets a while ago).
  savedTargets = sh(ROUTER, 'uci -q get routelink.probe.target || true');
  const from = now() - 600;
  const before = await answeredProbes(call, SERVER_IP, from);
  uci(
    `while uci -q delete routelink.@quota[0]; do :; done; uci -q delete routelink.rltest; uci -q delete routelink.rlfail; ` +
      `uci set routelink.dns=dns; uci set routelink.dns.enabled=0; ` +
      `uci set routelink.probe=probe; uci -q delete routelink.probe.target; uci add_list routelink.probe.target=${SERVER_IP}`,
  );
  await waitForProbes(call, SERVER_IP, from, before + 1);
  // channels of an earlier run must be gone before the test adds them again (or it may talk to the old ones)
  await waitFor('the old test channels to go', 20, async () =>
    (await channels()).some((c) => TEST_CHANNELS.includes(c)) ? undefined : true,
  );
});

afterAll(() => {
  if (!supported) return;
  const restore = savedTargets
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `uci add_list routelink.probe.target=${t}; `)
    .join('');
  uci(
    `while uci -q delete routelink.@quota[0]; do :; done; uci -q delete routelink.rltest; uci -q delete routelink.rlfail; ` +
      `uci set routelink.dns.enabled=0; uci -q delete routelink.probe.target; ${restore}true`,
  );
  sh(CLIENT, 'pkill -x curl; true');
  sh(ROUTER, 'uci set firewall.@defaults[0].flow_offloading=0; uci commit firewall; fw4 -q reload; true');
});

describe('push messages', () => {
  it('sends the test message to a webhook and reports a failing channel', async () => {
    if (!supported) return console.warn('skipped: this plugin build has no quotas / push');
    uci(
      `uci set routelink.rltest=notify; uci set routelink.rltest.type=webhook; uci set routelink.rltest.enabled=1; ` +
        `uci set routelink.rltest.url=http://${SERVER_IP}:8080/hook/${RUN}; ` +
        `uci add_list routelink.rltest.events=quota; uci add_list routelink.rltest.events=device_new; ` +
        `uci set routelink.rlfail=notify; uci set routelink.rlfail.type=webhook; ` +
        `uci set routelink.rlfail.url=http://${SERVER_IP}:8080/hook/fail-${RUN}; uci add_list routelink.rlfail.events=quota`,
    );
    // reload_config returns before the daemon has read the configuration again
    await waitFor('the test channels', 20, async () => {
      const loaded = await channels();
      return TEST_CHANNELS.every((c) => loaded.includes(c)) ? true : undefined;
    });
    const t0 = Date.now();
    expect(await call('notify_test', { section: 'rltest' })).toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(15_000);
    const [hook] = hooks();
    expect(hook.path).toBe(`/hook/${RUN}`);
    const msg = JSON.parse(hook.body) as { title: string; body: string };
    expect(msg.title).toMatch(/RouteLink/);
    // 23.05's uclient-fetch cannot set the header: the JSON goes out as a form there
    expect(hook.type).toMatch(/application\/json|x-www-form-urlencoded/);

    expect(await call('notify_test', { section: 'rlfail' })).toEqual({ ok: false, error: 'HTTP error 500' });
    await expect(call('notify_test', { section: 'nope' })).rejects.toThrow();
    const status = await call<{ channels: { section: string; last_ok: number; last_error: string }[] }>(
      'notify_status',
    );
    expect(status.channels.find((c) => c.section === 'rltest')?.last_ok).toBeGreaterThan(0);
    expect(status.channels.find((c) => c.section === 'rlfail')?.last_error).toBe('HTTP error 500');
  });
});

describe('DNS log and destinations', () => {
  const name = `www.rl-${RUN}.example`;

  it('records the answers the lab client gets', async () => {
    if (!supported) return;
    uci('uci set routelink.dns.enabled=1');
    await waitFor('DNS logging', 20, async () => ((await call<Info>('info')).dns_enabled ? true : undefined));
    const t0 = now();
    sh(
      CLIENT,
      `nslookup -type=A ${name} ${SERVER_IP} >/dev/null; nslookup -type=A nx-${RUN}.example ${SERVER_IP}; true`,
    );
    const log = await waitFor('the DNS records', 15, async () => {
      const r = await call<{ count: number; records: DnsRecord[] }>('dns', {
        start: t0 - 5,
        end: now() + 5,
        mac,
        q: RUN.toUpperCase(), // matched case-insensitively
      });
      return r.count >= 2 ? r : undefined;
    });
    const a = log.records.find((r) => r.name === name);
    expect(a).toMatchObject({ mac, type: 'A', rcode: 'NOERROR', answers: [SERVER_IP] });
    expect(log.records.find((r) => r.name === `nx-${RUN}.example`)).toMatchObject({ rcode: 'NXDOMAIN', answers: [] });
    // newest first, paged
    const page = await call<{ count: number; records: DnsRecord[] }>('dns', {
      start: t0 - 5,
      end: now() + 5,
      limit: 1,
      offset: 1,
      q: RUN,
    });
    expect(page.count).toBe(log.count);
    expect(page.records).toHaveLength(1);
    await expect(call('dns', { start: 10, end: 5 })).rejects.toThrow();
  });

  it('sums the traffic per destination and names it from the DNS answers', async () => {
    if (!supported) return;
    sh(
      CLIENT,
      `nslookup -type=A ${name} ${SERVER_IP} >/dev/null; curl -s -o /dev/null http://${SERVER_IP}:8080/3000000`,
    );
    const t0 = now() - 3600;
    const dest = await waitFor('the destination', 60, async () => {
      await call('live'); // samples every 2 s for a while
      const r = await call<{ destinations: { host?: string; ip: string; rx: number; tx: number; conns: number }[] }>(
        'destinations',
        { mac, start: t0, end: now() + 60 },
      );
      const d = r.destinations.find((x) => x.ip === SERVER_IP);
      return d && d.rx >= 3_000_000 ? d : undefined;
    });
    expect(dest.host).toBe(name);
    expect(dest.conns).toBeGreaterThanOrEqual(1);
    await expect(call('destinations', { mac: '02:00:00:00:00:01', start: t0, end: now() })).rejects.toThrow();
  });
});

describe('quota', () => {
  let section = '';

  it('blocks the device once its quota is used up, an established connection included', async () => {
    if (!supported) return;
    // software offloading on: the established connection runs in the flowtable (where the kernel has one)
    sh(ROUTER, 'uci set firewall.@defaults[0].flow_offloading=1; uci commit firewall; fw4 -q reload');
    // first far above today's use, to read it: the unlimited rate tests (limits.agent.ts) alone move tens of
    // GB a run, at the speed of a Docker bridge
    uci(
      `uci add routelink quota >/dev/null; uci set routelink.@quota[-1].mac=${mac}; ` +
        `uci set routelink.@quota[-1].period=day; uci set routelink.@quota[-1].limit_mb=100000000; ` +
        `uci set routelink.@quota[-1].action=block`,
    );
    const q0 = await waitFor('the quota', 20, () => quotaOf(mac));
    section = q0.section;
    expect(q0).toMatchObject({ period: 'day', action: 'block', state: 'ok' });
    expect(q0.period_end - q0.period_start).toBeGreaterThanOrEqual(23 * 3600);
    // a quota a few MB above today's use, then a long, slow download that stays open
    const limitMb = Math.ceil(q0.used / 1048576) + 4;
    uci(`uci set routelink.@quota[-1].limit_mb=${limitMb}`);
    execFileSync(
      'docker',
      ['exec', '-d', CLIENT, 'sh', '-c', `curl -s --limit-rate 100k -o /tmp/long http://${SERVER_IP}:8080/1000000000`],
      { env },
    );
    await sleep(3000);
    // what is left of the quota and a MB more: not the whole quota again, which after the rate tests is tens
    // of GB that would still be on the way when the block comes (curl then waits for good)
    const over = (limitMb + 1) * 1048576 - q0.used;
    sh(CLIENT, `curl -s -m 60 -o /dev/null http://${SERVER_IP}:8080/${over}`);
    // the next sample counts it, the next minute acts on it
    const q = await waitFor('the block', 100, async () => {
      await call('live');
      const x = await quotaOf(mac);
      return x?.state === 'exceeded' ? x : undefined;
    });
    expect(q.used).toBeGreaterThanOrEqual(q.limit);
    expect(q.pct).toBeGreaterThanOrEqual(100);
    await waitFor('the nftables table', 10, () =>
      sh(ROUTER, 'nft list table inet routelink 2>/dev/null; true').includes(mac.toLowerCase()) ? true : undefined,
    );
    // The long download stopped (on the wire: curl still reads what its socket buffered, slowly), new
    // connections fail, the LAN still works.
    const rx = () => Number(sh(CLIENT, 'cat /sys/class/net/eth0/statistics/rx_bytes'));
    const rx0 = rx();
    await sleep(4000);
    expect(rx() - rx0).toBeLessThan(64 * 1024); // 400 KB while it ran
    expect(online()).toBe(false);
    expect(ok(CLIENT, `ping -c 1 -W 2 ${ROUTER_LAN_IP}`)).toBe(true);
    const ev = await call<{ events: { type: string; mac?: string; value?: number }[] }>('events', {
      start: now() - 300,
      end: now() + 1,
      types: ['quota_exceeded'],
      mac,
    });
    expect(ev.events.length).toBeGreaterThanOrEqual(1);
  });

  it('sends the quota notice to the push channel', async () => {
    if (!supported || !section) return;
    // the batch goes a minute after its first event; the failing channel gets it too (and answers 500)
    const sent = await waitFor('the quota notice', 90, () => {
      const got = hooks().filter((h) => /used up its data|流量用完了/.test(h.body));
      const paths = got.map((h) => h.path);
      return paths.includes(`/hook/${RUN}`) && paths.includes(`/hook/fail-${RUN}`) ? got : undefined;
    });
    expect(sent.length).toBeGreaterThanOrEqual(2);
    // a failure is tried again later (after 10 s)
    const status = await call<{ channels: { section: string; last_error: string }[]; pending: number }>(
      'notify_status',
    );
    expect(status.channels.find((c) => c.section === 'rlfail')?.last_error).toBe('HTTP error 500');
  });

  it('lets the device through again with quota_allow', async () => {
    if (!supported || !section) return;
    await expect(call('quota_allow', { section, until: 'tomorrow' })).rejects.toThrow();
    await expect(call('quota_allow', { section: 'cfgnope', until: 'hour' })).rejects.toThrow();
    expect(await call('quota_allow', { section, until: 'hour' })).toEqual({});
    const q = await quotaOf(mac);
    expect(q?.state).toBe('allowed');
    expect(q!.allow_until).toBeGreaterThan(now() + 3500);
    await waitFor('the internet', 10, () => (online() ? true : undefined));
    expect(sh(ROUTER, 'nft list tables')).not.toMatch(/routelink/);
  });
});
