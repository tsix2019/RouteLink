/**
 * Speed limits (design §9.1, P4).
 *
 * - T1, the technical check: core/tcgen's script applied by hand to the router's LAN port (HTB + flower for
 *   download, clsact + police for upload), measured with and without software flow offloading (±10 %).
 * - T11: the same through the daemon, from a UCI `limit` rule: set up on the LAN bridge ports, measured,
 *   removed again with the rule, and a rule whose time window is not now stays off.
 *
 * Needs sch_htb, cls_flower and act_police in the host kernel (CI loads them; WSL2's kernel has none, so
 * locally the tests report themselves skipped).
 *
 * Another router instance (RL_AGENT_NAME / RL_AGENT_NET in the scripts): set ROUTER_CONTAINER, LAB_CLIENT,
 * LAB_SERVER and LAB_SERVER_IP.
 */
import { execFileSync } from 'node:child_process';

const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const CLIENT = process.env.LAB_CLIENT ?? 'routelink-lab-client';
const SERVER = process.env.LAB_SERVER ?? 'routelink-lab-server';
const SERVER_IP = process.env.LAB_SERVER_IP ?? '172.41.0.10';
const DOWN_KBPS = 20_000;
const UP_KBPS = 8_000;
const SECONDS = 8;

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (container: string, cmd: string, input?: string) =>
  execFileSync('docker', ['exec', '-i', container, 'sh', '-c', cmd], {
    env,
    encoding: 'utf8',
    input,
    maxBuffer: 1 << 26,
  }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const macOf = (container: string) => sh(container, 'cat /sys/class/net/eth0/address');
const bytes = (container: string, dir: 'rx' | 'tx') =>
  Number(sh(container, `cat /sys/class/net/eth0/statistics/${dir}_bytes`));

/** The router's LAN device: Docker does not keep the order of a container's networks (eth0 or eth1). */
const lanDev = () => sh(ROUTER, "ubus call network.interface.lan status | jsonfilter -e '@.l3_device'");

/** The setup script core/tcgen writes for one device (kept in step with test_gen.c). */
function tcScript(dev: string, mac: string, downKbps: number, upKbps: number): string {
  const burst = Math.max(131072, Math.floor((upKbps * 1000) / 8 / 10));
  return [
    `qdisc add dev ${dev} root handle 1: htb default 1`,
    `class add dev ${dev} parent 1: classid 1:1 htb rate 10gbit quantum 1514`,
    `class add dev ${dev} parent 1: classid 1:10 htb rate ${downKbps}kbit ceil ${downKbps}kbit quantum 1514`,
    `filter add dev ${dev} parent 1: protocol all prio 1 flower dst_mac ${mac} classid 1:10`,
    `qdisc add dev ${dev} clsact`,
    `filter add dev ${dev} ingress protocol all prio 1 flower src_mac ${mac} action police rate ${upKbps}kbit burst ${burst} mtu 65536 conform-exceed drop`,
    '',
  ].join('\n');
}

/** core/tcgen's clear script: the deletes may fail on a port with nothing set up. */
function clear(dev: string) {
  sh(
    ROUTER,
    `printf 'qdisc del dev ${dev} root handle 1: htb\nqdisc del dev ${dev} clsact\n' | tc -force -batch - 2>/dev/null; true`,
  );
}

/** Clears the port, then sets up: every setup command has to succeed. */
function apply(dev: string, mac: string) {
  clear(dev);
  sh(ROUTER, `tc -batch -`, tcScript(dev, mac, DOWN_KBPS, UP_KBPS));
}

/** What tc has on the port, for the log when a number is off. */
const tcState = (dev: string) =>
  sh(
    ROUTER,
    `tc -s qdisc show dev ${dev}; tc -s class show dev ${dev}; tc -s filter show dev ${dev}; tc -s filter show dev ${dev} ingress; true`,
  );

/** Software flow offloading through fw4's flowtable; returns whether a flowtable is actually active. */
function setOffload(on: boolean): boolean {
  sh(ROUTER, `uci set firewall.@defaults[0].flow_offloading=${on ? 1 : 0}; uci commit firewall; fw4 -q reload`);
  return /flowtable/.test(sh(ROUTER, 'nft list ruleset'));
}

/** Rate in kbit/s measured on `container`'s eth0 while `cmd` runs on the client for SECONDS. */
async function measure(container: string, dir: 'rx' | 'tx', cmd: string): Promise<number> {
  execFileSync('docker', ['exec', '-d', CLIENT, 'sh', '-c', cmd], { env });
  await sleep(2_000); // slow start and the burst bucket draining
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
  if (Math.abs(kbps - limit) / limit >= 0.1) console.log(`tc on ${dev}:\n${tcState(dev)}`);
  expect(Math.abs(kbps - limit) / limit).toBeLessThan(0.1);
}

let supported = true;
let clientMac = '';
let dev = 'eth0';

beforeAll(() => {
  clientMac = macOf(CLIENT);
  dev = lanDev() || dev;
  // The rootfs images have no tc; the plugin package depends on tc-tiny.
  sh(
    ROUTER,
    'command -v tc >/dev/null || { opkg update >/dev/null && opkg install tc-tiny >/dev/null; } 2>/dev/null || ' +
      '{ apk update >/dev/null && apk add tc-tiny >/dev/null; }',
  );
  try {
    sh(ROUTER, `tc qdisc add dev ${dev} root handle 1: htb default 1 && tc qdisc del dev ${dev} root`);
  } catch {
    supported = false;
  }
});

afterAll(() => {
  clear(dev);
  setOffload(false);
});

describe.each([
  ['software offloading off', false],
  ['software offloading on', true],
])('speed limits set by hand with %s', (_name, offload) => {
  let offloadActive = false;

  beforeAll(() => {
    if (!supported) return;
    offloadActive = setOffload(offload);
    apply(dev, clientMac);
  });

  afterAll(() => {
    if (supported) clear(dev);
  });

  it('download stays within ±10 % of the limit', async () => {
    if (!supported) return console.warn('skipped: no sch_htb in this kernel');
    if (offload && !offloadActive) console.warn('flowtable did not come up: measuring without offload');
    await expectRate(dev, `download ${offload ? 'with' : 'without'} offload`, CLIENT, DOWNLOAD, DOWN_KBPS);
  });

  it('upload stays within ±10 % of the limit', async () => {
    if (!supported) return;
    await expectRate(dev, `upload ${offload ? 'with' : 'without'} offload`, SERVER, UPLOAD, UP_KBPS);
  });

  it('a device without a rule is not slowed down', async () => {
    if (!supported) return;
    apply(dev, '02:00:00:00:00:99');
    const kbps = await measure(CLIENT, 'rx', DOWNLOAD);
    console.log(`unlimited download ${offload ? 'with' : 'without'} offload: ${Math.round(kbps)} kbit/s`);
    if (kbps <= DOWN_KBPS * 2) console.log(`tc on ${dev}:\n${tcState(dev)}`);
    expect(kbps).toBeGreaterThan(DOWN_KBPS * 2);
    apply(dev, clientMac);
  });
});

/** The daemon's view: info.limits_error and the limit_applied events. */
const info = () =>
  JSON.parse(sh(ROUTER, 'ubus call routelink info')) as { capabilities?: string[]; limits_error?: string };
const hasHtb = () => /htb 1:/.test(sh(ROUTER, `tc qdisc show dev ${dev}`));

async function waitFor(what: string, seconds: number, ok: () => boolean) {
  for (let i = 0; i < seconds; i++) {
    if (ok()) return;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Adds a limit section for the client (extra options: [name, value]) and reloads the daemon. */
function addRule(extra: [string, string][] = []) {
  const opts = [
    ['mac', clientMac.toUpperCase()],
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

describe('speed limits set by the daemon from a UCI rule', () => {
  let daemon = false;

  beforeAll(() => {
    clear(dev);
    setOffload(true); // the usual case on a router
    removeRules();
    daemon = !!info().capabilities?.includes('limits');
  });

  afterAll(() => {
    removeRules();
    setOffload(false);
  });

  it('sets the limit up on the LAN port within seconds, or reports why not', async () => {
    if (!daemon) return console.warn('skipped: this plugin build has no limits');
    addRule();
    await waitFor('the limit or an error', 20, () => hasHtb() || !!info().limits_error);
    if (!supported) {
      // WSL2: no sch_htb. The daemon says so instead of retrying.
      expect(info().limits_error).toMatch(/unknown|not supported|No such file/i);
      return console.warn(`skipped: ${info().limits_error}`);
    }
    expect(info().limits_error).toBe('');
    expect(sh(ROUTER, `tc filter show dev ${dev} ingress`)).toMatch(/police/);
  });

  it('download stays within ±10 % of the limit', async () => {
    if (!daemon || !supported) return;
    await expectRate(dev, 'daemon download', CLIENT, DOWNLOAD, DOWN_KBPS);
  });

  it('upload stays within ±10 % of the limit', async () => {
    if (!daemon || !supported) return;
    await expectRate(dev, 'daemon upload', SERVER, UPLOAD, UP_KBPS);
  });

  it('comes back after the port lost its qdiscs', async () => {
    if (!daemon || !supported) return;
    clear(dev); // like a wifi reload re-creating the interface
    sh(ROUTER, `ubus send network.device '{"action":"up","name":"${dev}"}'`); // what netifd sends
    await waitFor('the limit to come back', 70, hasHtb);
  });

  it('goes away with the rule, and a rule outside its time window stays off', async () => {
    if (!daemon || !supported) return;
    removeRules();
    await waitFor('the limit to go', 20, () => !hasHtb());
    // a window that began two hours ago and ended an hour ago (router time)
    const h = Number(sh(ROUTER, 'date +%H'));
    const hh = (x: number) => String((x + 24) % 24).padStart(2, '0');
    addRule([
      ['start_time', `${hh(h - 2)}:00`],
      ['stop_time', `${hh(h - 1)}:00`],
    ]);
    await sleep(5000);
    expect(hasHtb()).toBe(false);
    expect(info().limits_error).toBe('');
  });
});
