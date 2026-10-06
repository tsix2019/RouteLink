/**
 * P4 T1, the speed-limit technical check (design §9.1): are tc limits on the LAN port accurate (±10 %)
 * with and without software flow offloading? The router's LAN port gets the same tc script core/tcgen
 * writes (HTB + flower for download, clsact + police for upload); the lab client downloads from and uploads
 * to the lab server while the counters measure the rate.
 *
 * Needs sch_htb, cls_flower and act_police in the host kernel (CI loads them; WSL2's kernel has no HTB,
 * so locally the test reports itself skipped).
 */
import { execFileSync } from 'node:child_process';

const ROUTER = process.env.ROUTER_CONTAINER ?? 'routelink-agent-owrt';
const CLIENT = 'routelink-lab-client';
const SERVER = 'routelink-lab-server';
const LAN_DEV = 'eth0';
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

/** The script core/tcgen writes for one device (kept in step with test_gen.c). */
function tcScript(mac: string, downKbps: number, upKbps: number): string {
  const d = LAN_DEV;
  return [
    `qdisc del dev ${d} root handle 1: htb`,
    `qdisc del dev ${d} clsact`,
    `qdisc add dev ${d} root handle 1: htb default 1`,
    `class add dev ${d} parent 1: classid 1:1 htb rate 10gbit quantum 1514`,
    `class add dev ${d} parent 1: classid 1:10 htb rate ${downKbps}kbit ceil ${downKbps}kbit quantum 1514`,
    `filter add dev ${d} parent 1: protocol all prio 1 flower dst_mac ${mac} classid 1:10`,
    `qdisc add dev ${d} clsact`,
    `filter add dev ${d} ingress protocol all prio 1 flower src_mac ${mac} action police rate ${upKbps}kbit burst ${Math.max(16384, (upKbps * 1000) / 8 / 50)} conform-exceed drop`,
    '',
  ].join('\n');
}

function clear() {
  sh(ROUTER, `tc qdisc del dev ${LAN_DEV} root 2>/dev/null; tc qdisc del dev ${LAN_DEV} clsact 2>/dev/null; true`);
}

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
  sh(CLIENT, 'pkill -f curl; true');
  await sleep(500);
  // IP-level rate: Ethernet headers are about 1 % at full-size frames; ignore them.
  return ((b1 - b0) * 8) / ((t1 - t0) / 1000) / 1000;
}

const DOWNLOAD = `for i in 1 2 3 4; do curl -s -o /dev/null http://172.41.0.10:8080/2000000000 & done; wait`;
const UPLOAD = `head -c 400000000 /dev/zero > /tmp/up; for i in 1 2 3 4; do curl -s -o /dev/null --data-binary @/tmp/up http://172.41.0.10:8080/ & done; wait`;

let supported = true;
let clientMac = '';

beforeAll(() => {
  clientMac = macOf(CLIENT);
  // The rootfs images have no tc; the plugin package will depend on tc-tiny.
  sh(
    ROUTER,
    'command -v tc >/dev/null || { opkg update >/dev/null && opkg install tc-tiny >/dev/null; } 2>/dev/null || ' +
      '{ apk update >/dev/null && apk add tc-tiny >/dev/null; }',
  );
  try {
    sh(ROUTER, `tc qdisc add dev ${LAN_DEV} root handle 1: htb default 1 && tc qdisc del dev ${LAN_DEV} root`);
  } catch {
    supported = false;
  }
});

afterAll(() => {
  clear();
  setOffload(false);
});

describe.each([
  ['software offloading off', false],
  ['software offloading on', true],
])('speed limits with %s', (_name, offload) => {
  let offloadActive = false;

  beforeAll(() => {
    if (!supported) return;
    offloadActive = setOffload(offload);
    sh(ROUTER, `tc -force -batch -`, tcScript(clientMac, DOWN_KBPS, UP_KBPS));
  });

  it('download stays within ±10 % of the limit', async () => {
    if (!supported) return console.warn('skipped: no sch_htb in this kernel');
    if (offload && !offloadActive) console.warn('flowtable did not come up: measuring without offload');
    const kbps = await measure(CLIENT, 'rx', DOWNLOAD);
    console.log(`download ${offload ? 'with' : 'without'} offload: ${Math.round(kbps)} kbit/s (limit ${DOWN_KBPS})`);
    expect(Math.abs(kbps - DOWN_KBPS) / DOWN_KBPS).toBeLessThan(0.1);
  });

  it('upload stays within ±10 % of the limit', async () => {
    if (!supported) return;
    const kbps = await measure(SERVER, 'rx', UPLOAD);
    console.log(`upload ${offload ? 'with' : 'without'} offload: ${Math.round(kbps)} kbit/s (limit ${UP_KBPS})`);
    expect(Math.abs(kbps - UP_KBPS) / UP_KBPS).toBeLessThan(0.1);
  });

  it('a device without a rule is not slowed down', async () => {
    if (!supported) return;
    sh(ROUTER, `tc -force -batch -`, tcScript('02:00:00:00:00:99', DOWN_KBPS, UP_KBPS));
    const kbps = await measure(CLIENT, 'rx', DOWNLOAD);
    console.log(`unlimited download ${offload ? 'with' : 'without'} offload: ${Math.round(kbps)} kbit/s`);
    expect(kbps).toBeGreaterThan(DOWN_KBPS * 2);
    sh(ROUTER, `tc -force -batch -`, tcScript(clientMac, DOWN_KBPS, UP_KBPS));
  });
});
