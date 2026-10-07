/**
 * Speed limits (design §9.1, P4 T1 and T11), set by the daemon from a UCI `limit` rule: HTB per LAN port
 * for downloads, uploads redirected to an ifb with HTB (policing dropped too much for TCP: 50–85 % of the
 * limit in CI). Measured with and without software flow offloading (±10 %); a device without a rule keeps
 * its speed; the limit comes back after its qdiscs were lost, goes with the rule, and stays off outside its
 * time window.
 *
 * Needs sch_htb, cls_flower, act_mirred and ifb in the host kernel. CI loads them, and with CI set a
 * missing one (or a plugin build without limits) fails the whole file instead of skipping it. WSL2's kernel
 * has no HTB, so locally the rate tests report themselves skipped and only the error report is checked.
 *
 * Another router instance (RL_AGENT_NAME / RL_AGENT_NET in the scripts): set ROUTER_CONTAINER, LAB_CLIENT,
 * LAB_SERVER and LAB_SERVER_IP.
 */
import { execFileSync } from 'node:child_process';

const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const CLIENT = process.env.LAB_CLIENT ?? 'routelink-lab-client';
const SERVER = process.env.LAB_SERVER ?? 'routelink-lab-server';
const SERVER_IP = process.env.LAB_SERVER_IP ?? '172.41.0.10';
const CI = !!process.env.CI;
const DOWN_KBPS = 20_000;
const UP_KBPS = 8_000;
const SECONDS = 8;

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (container: string, cmd: string) =>
  execFileSync('docker', ['exec', '-i', container, 'sh', '-c', cmd], {
    env,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const macOf = (container: string) => sh(container, 'cat /sys/class/net/eth0/address');
const bytes = (container: string, dir: 'rx' | 'tx') =>
  Number(sh(container, `cat /sys/class/net/eth0/statistics/${dir}_bytes`));

/** The router's LAN device: Docker does not keep the order of a container's networks (eth0 or eth1). */
const lanDev = () => sh(ROUTER, "ubus call network.interface.lan status | jsonfilter -e '@.l3_device'");
const IFB = 'rl-ifb0';

/** What tc has on the port and the ifb, for the log when a number is off. */
const tcState = (dev: string) =>
  sh(
    ROUTER,
    [dev, IFB]
      .map((d) => `echo "== ${d}"; tc -s qdisc show dev ${d}; tc -s class show dev ${d}; tc -s filter show dev ${d}`)
      .join('; ') + `; tc -s filter show dev ${dev} ingress; true`,
  );

/** Software flow offloading through fw4's flowtable; returns whether a flowtable is actually active. */
function setOffload(on: boolean): boolean {
  sh(ROUTER, `uci set firewall.@defaults[0].flow_offloading=${on ? 1 : 0}; uci commit firewall; fw4 -q reload; true`);
  return /flowtable/.test(sh(ROUTER, 'nft list ruleset'));
}

/** Rate in kbit/s measured on `container`'s eth0 while `cmd` runs on the client for SECONDS. */
async function measure(container: string, dir: 'rx' | 'tx', cmd: string): Promise<number> {
  execFileSync('docker', ['exec', '-d', CLIENT, 'sh', '-c', cmd], { env });
  await sleep(2_000); // slow start
  const b0 = bytes(container, dir);
  const t0 = Date.now();
  await sleep(SECONDS * 1000);
  const b1 = bytes(container, dir);
  const t1 = Date.now();
  // -x: by process name; -f would match this very shell, whose command line says curl too.
  sh(CLIENT, 'pkill -x curl; true');
  await sleep(500);
  // IP-level rate: Ethernet headers are about 1 % at full-size frames; ignore them.
  return ((b1 - b0) * 8) / ((t1 - t0) / 1000) / 1000;
}

const DOWNLOAD = `for i in 1 2 3 4; do curl -s -o /dev/null http://${SERVER_IP}:8080/2000000000 & done; wait`;
const UPLOAD = `head -c 400000000 /dev/zero > /tmp/up; for i in 1 2 3 4; do curl -s -o /dev/null --data-binary @/tmp/up http://${SERVER_IP}:8080/ & done; wait`;

/** Measures, logs, and on a miss logs what tc had. */
async function expectRate(dev: string, what: string, container: string, cmd: string, limit: number) {
  const kbps = await measure(container, 'rx', cmd);
  console.log(`${what}: ${Math.round(kbps)} kbit/s (limit ${limit})`);
  if (Math.abs(kbps - limit) / limit >= 0.1) console.log(`tc:\n${tcState(dev)}`);
  expect(Math.abs(kbps - limit) / limit).toBeLessThan(0.1);
}

const info = () =>
  JSON.parse(sh(ROUTER, 'ubus call routelink info')) as { capabilities?: string[]; limits_error?: string };
const hasHtb = (dev: string) => /htb 1:/.test(sh(ROUTER, `tc qdisc show dev ${dev}`));
const filters = (dev: string) => sh(ROUTER, `tc filter show dev ${dev}; tc filter show dev ${dev} ingress`);

async function waitFor(what: string, seconds: number, ok: () => boolean) {
  for (let i = 0; i < seconds; i++) {
    if (ok()) return;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Adds a limit section (mac and extra options) and reloads the daemon. */
function addRule(mac: string, extra: [string, string][] = []) {
  const opts = [
    ['mac', mac.toUpperCase()],
    ['enabled', '1'],
    ['download', String(DOWN_KBPS)],
    ['upload', String(UP_KBPS)],
    ...extra,
  ]
    .map(([k, v]) => `uci set routelink.@limit[-1].${k}='${v}'`)
    .join('; ');
  sh(ROUTER, `uci add routelink limit >/dev/null; ${opts}; uci commit routelink; reload_config`);
}

const removeRules = () =>
  sh(ROUTER, 'while uci -q delete routelink.@limit[0]; do :; done; uci commit routelink; reload_config');

/** Why the kernel cannot shape (no sch_htb), or null. Run on a port without limits: a root qdisc fails it. */
function htbMissing(): string | null {
  try {
    sh(
      ROUTER,
      `tc qdisc del dev ${dev} root 2>/dev/null; tc qdisc add dev ${dev} root handle 1: htb default 1 && tc qdisc del dev ${dev} root`,
    );
    return null;
  } catch (e) {
    return `no sch_htb in this kernel: ${(e as Error).message.trim().split('\n').pop()}`;
  }
}

let daemon = false;
let supported = true;
let clientMac = '';
let dev = 'eth0';

beforeAll(async () => {
  clientMac = macOf(CLIENT);
  dev = lanDev() || dev;
  daemon = !!info().capabilities?.includes('limits');
  if (daemon) {
    // rules an earlier run left: the daemon takes their qdiscs down after the reload
    removeRules();
    await waitFor('earlier limits to go', 20, () => !hasHtb(dev)).catch(() =>
      console.warn(`limits are left on ${dev}:\n${tcState(dev)}`),
    );
  }
  const missing = htbMissing();
  supported = !missing;
  // CI loads the modules (.github/workflows/openwrt.yml): skipping there would pass without testing anything
  if (CI && !daemon) throw new Error('CI: this plugin build has no limits');
  if (CI && missing) throw new Error(`CI: ${missing}`);
  if (missing) console.warn(`rate tests skipped: ${missing}`);
});

afterAll(() => {
  if (daemon) removeRules();
  setOffload(false);
});

describe.each([
  ['software offloading off', false],
  ['software offloading on', true],
])('speed limits with %s', (_name, offload) => {
  beforeAll(async () => {
    if (!daemon || !supported) return;
    const active = setOffload(offload);
    if (offload && !active) console.warn('flowtable did not come up: measuring without offload');
    addRule(clientMac);
    await waitFor('the limit', 30, () => hasHtb(dev) && hasHtb(IFB));
  });

  afterAll(() => {
    if (daemon && supported) removeRules();
  });

  it('download stays within ±10 % of the limit', async () => {
    if (!daemon) return console.warn('skipped: this plugin build has no limits');
    if (!supported) return console.warn('skipped: no sch_htb in this kernel');
    // also where a missing ifb shows up (uploads: cannot create rl-ifb0)
    expect(info().limits_error).toBe('');
    await expectRate(dev, `download ${offload ? 'with' : 'without'} offload`, CLIENT, DOWNLOAD, DOWN_KBPS);
  });

  it('upload stays within ±10 % of the limit', async () => {
    if (!daemon || !supported) return;
    await expectRate(dev, `upload ${offload ? 'with' : 'without'} offload`, SERVER, UPLOAD, UP_KBPS);
  });

  it('a device without a rule is not slowed down', async () => {
    if (!daemon || !supported) return;
    removeRules();
    addRule('02:00:00:00:00:99');
    await waitFor('the other rule', 30, () => /02:00:00:00:00:99/.test(filters(dev)));
    const kbps = await measure(CLIENT, 'rx', DOWNLOAD);
    console.log(`unlimited download ${offload ? 'with' : 'without'} offload: ${Math.round(kbps)} kbit/s`);
    if (kbps <= DOWN_KBPS * 2) console.log(`tc:\n${tcState(dev)}`);
    expect(kbps).toBeGreaterThan(DOWN_KBPS * 2);
    const up = await measure(SERVER, 'rx', UPLOAD);
    console.log(`unlimited upload ${offload ? 'with' : 'without'} offload: ${Math.round(up)} kbit/s`);
    expect(up).toBeGreaterThan(UP_KBPS * 2);
  });
});

describe('the daemon keeps the limits in place', () => {
  beforeAll(() => {
    if (daemon) removeRules();
  });

  it('sets the limit up within seconds, or reports why not', async () => {
    if (!daemon) return;
    addRule(clientMac);
    await waitFor('the limit or an error', 30, () => hasHtb(dev) || !!info().limits_error);
    if (!supported) {
      // WSL2: no sch_htb. The daemon says so instead of retrying. (Never in CI: beforeAll fails there.)
      expect(CI).toBe(false);
      expect(info().limits_error).toMatch(/unknown|not supported|No such file/i);
      return console.warn(`skipped: ${info().limits_error}`);
    }
    expect(info().limits_error).toBe('');
    expect(filters(dev)).toMatch(/mirred/);
  });

  it('comes back after the port lost its qdiscs', async () => {
    if (!daemon || !supported) return;
    // like a wifi reload re-creating the interface
    sh(ROUTER, `tc qdisc del dev ${dev} root; tc qdisc del dev ${dev} clsact; true`);
    sh(ROUTER, `ubus send network.device '{"action":"up","name":"${dev}"}'`); // what netifd sends
    await waitFor('the limit to come back', 70, () => hasHtb(dev) && /mirred/.test(filters(dev)));
  });

  it('goes away with the rule, and a rule outside its time window stays off', async () => {
    if (!daemon || !supported) return;
    removeRules();
    await waitFor('the limit to go', 20, () => !hasHtb(dev));
    expect(sh(ROUTER, `ip link show ${IFB} 2>&1; true`)).toMatch(/does not exist|not found|can.?t find|cannot find/i);
    // a window that began two hours ago and ended an hour ago (router time)
    const h = Number(sh(ROUTER, 'date +%H'));
    const hh = (x: number) => String((x + 24) % 24).padStart(2, '0');
    addRule(clientMac, [
      ['start_time', `${hh(h - 2)}:00`],
      ['stop_time', `${hh(h - 1)}:00`],
    ]);
    await sleep(5000);
    expect(hasHtb(dev)).toBe(false);
    expect(info().limits_error).toBe('');
  });
});
