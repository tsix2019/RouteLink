import type { UciSection } from '../../uci';
import { createDemoAdmin, type DemoAdmin } from './admin';
import { createDemoAgent, type DemoAgent } from './agent';
import { createRandom, type Random } from './random';

export interface DemoDevice {
  mac: string;
  hostname: string;
  ip: string;
  kind: 'wifi' | 'wired';
  radio?: 'radio0' | 'radio1';
  online: boolean;
  signal: number;
  rxRate: number;
  txRate: number;
  connectedSec: number;
  /** Absolute ms timestamp until which a kicked station stays away. */
  bannedUntil?: number;
}

export interface DemoState {
  rng: Random;
  /** ms epoch of the simulated boot */
  bootTime: number;
  rebootingUntil?: number;
  lastTick: number;
  /** cumulative byte counters per network device */
  counters: Record<string, { rx: number; tx: number }>;
  /** current simulated WAN rate in bytes/s, random-walked on every tick */
  wanRate: { rx: number; tx: number };
  load: [number, number, number];
  devices: DemoDevice[];
  uci: Record<string, Record<string, UciSection>>;
  services: Record<string, { enabled: boolean; running: boolean; start?: number }>;
  syslog: string[];
  kernel: string[];
  /** The router plugin (installed from the start; can be removed and installed again). */
  agent: DemoAgent;
  /** Processes, crontab and clock. */
  admin: DemoAdmin;
}

/** Real vendor prefixes so the device list shows believable vendors. */
const DEVICES: [hostname: string, oui: string, kind: 'wifi' | 'wired', radio?: 'radio0' | 'radio1'][] = [
  ['iPhone-16-Pro', '000393', 'wifi', 'radio1'],
  ['MacBook-Air', '000393', 'wifi', 'radio1'],
  ['iPad', '000393', 'wifi', 'radio1'],
  ['Pixel-9', '001A11', 'wifi', 'radio1'],
  ['Galaxy-S25', '0000F0', 'wifi', 'radio1'],
  ['Living-Room-TV', '00A159', 'wifi', 'radio1'],
  ['Nintendo-Switch', '0009BF', 'wifi', 'radio0'],
  ['Echo-Dot', '007147', 'wifi', 'radio0'],
  ['Front-Camera', '00BC99', 'wifi', 'radio0'],
  ['Smart-Plug', '004B12', 'wifi', 'radio0'],
  ['Desk-PC', '0002B3', 'wired'],
  ['NAS', '001132', 'wired'],
  ['HP-LaserJet', '0068EB', 'wired'],
  ['ThinkPad', '10C595', 'wired'],
  ['Sonos-One', '000E58', 'wired'],
];

const OFFLINE = new Set(['ThinkPad', 'iPad']);
const STATIC_HOST = 'NAS';
const BLOCKED_HOST = 'Smart-Plug';

function section(name: string, type: string, values: Record<string, string | string[]>, anonymous = false): UciSection {
  return { '.name': name, '.type': type, '.anonymous': anonymous, ...values } as UciSection;
}

const SERVICES: [string, boolean, boolean, number?][] = [
  ['boot', true, false, 10],
  ['cron', true, true, 50],
  ['dnsmasq', true, true, 19],
  ['dropbear', true, true, 19],
  ['firewall', true, true, 19],
  ['gpio_switch', true, false, 98],
  ['led', true, true, 96],
  ['log', true, true, 12],
  ['network', true, true, 20],
  ['odhcpd', true, true, 35],
  ['rpcd', true, true, 12],
  ['sysctl', true, false, 11],
  ['sysfixtime', true, false, 0],
  ['sysntpd', true, true, 98],
  ['system', true, true, 10],
  ['uhttpd', true, true, 50],
  ['umount', true, false],
  ['urandom_seed', true, false, 99],
  ['urngd', true, true, 0],
  ['wpad', true, true, 19],
  ['wireguard_watchdog', false, false],
];

function buildSyslog(rng: Random, devices: DemoDevice[]): string[] {
  const lines: string[] = [];
  const base = new Date('2026-10-05T08:00:00Z').getTime();
  const stamp = (offsetSec: number) => {
    const d = new Date(base + offsetSec * 1000);
    const day = d.toUTCString().slice(0, 3);
    const mon = d.toUTCString().slice(8, 11);
    const date = String(d.getUTCDate()).padStart(2, ' ');
    const time = d.toISOString().slice(11, 19);
    return `${day} ${mon} ${date} ${time} ${d.getUTCFullYear()}`;
  };
  const templates: [string, (d: DemoDevice) => string][] = [
    ['daemon.info dnsmasq-dhcp[1]', (d) => `DHCPACK(br-lan) ${d.ip} ${d.mac.toLowerCase()} ${d.hostname}`],
    ['daemon.info dnsmasq-dhcp[1]', (d) => `DHCPREQUEST(br-lan) ${d.ip} ${d.mac.toLowerCase()}`],
    ['daemon.notice hostapd', (d) => `phy1-ap0: AP-STA-CONNECTED ${d.mac.toLowerCase()} auth_alg=sae`],
    ['daemon.info hostapd', (d) => `phy0-ap0: STA ${d.mac.toLowerCase()} WPA: pairwise key handshake completed (RSN)`],
  ];
  lines.push(`${stamp(0)} daemon.notice netifd: Interface 'wan' is now up`);
  lines.push(`${stamp(1)} daemon.notice netifd: Interface 'lan' is now up`);
  lines.push(`${stamp(2)} user.notice firewall: Reloading firewall due to ifup of wan (pppoe-wan)`);
  for (let i = 0; i < 117; i++) {
    const [prefix, text] = rng.pick(templates);
    lines.push(`${stamp(5 + i * 37)} ${prefix}: ${text(rng.pick(devices))}`);
  }
  return lines;
}

function buildKernel(): string[] {
  const msgs = [
    'Booting Linux on physical CPU 0x0000000000 [0x410fd034]',
    'Linux version 6.6.104 (builder@buildhost) #0 SMP Fri Jul 24 07:21:50 2026',
    'Machine model: OpenWrt One',
    'Memory: 1003372K/1048576K available',
    'mtk_soc_eth 15100000.ethernet eth0: mediatek frame engine at 0xffffffc081300000, irq 120',
    'mt7981-pinctrl 11d00000.pinctrl: gpio pin request failed',
    'br-lan: port 1(eth1) entered forwarding state',
    'mt7915e 0000:01:00.0: HW/SW Version: 0x8a108a10, Build Time: 20240823161250a',
    'pppoe-wan: renamed from ppp0',
    'wg0: no IPv6 routes',
  ];
  return msgs.map((m, i) => `<6>[${(i * 1.7 + 0.1).toFixed(6).padStart(12, ' ')}] ${m}`);
}

export function createDemoState(seed = 2026, now = Date.now()): DemoState {
  const rng = createRandom(seed);
  const devices: DemoDevice[] = DEVICES.map(([hostname, oui, kind, radio], i) => ({
    mac: `${oui.match(/../g)!.join(':')}:${rng.hex(3).join(':')}`,
    hostname,
    ip: `192.168.8.${101 + i}`,
    kind,
    radio,
    online: !OFFLINE.has(hostname),
    signal: kind === 'wifi' ? rng.int(-72, -38) : 0,
    rxRate: kind === 'wifi' ? rng.pick([144400, 286800, 573500, 866700, 1200900]) : 0,
    txRate: kind === 'wifi' ? rng.pick([173300, 433300, 866700, 1200900]) : 0,
    connectedSec: rng.int(120, 86400),
  }));
  const staticDev = devices.find((d) => d.hostname === STATIC_HOST)!;
  const blockedDev = devices.find((d) => d.hostname === BLOCKED_HOST)!;

  const uci: DemoState['uci'] = {
    system: {
      cfg01e48a: section(
        'cfg01e48a',
        'system',
        { hostname: 'RouteLink-Demo', timezone: 'CST-8', zonename: 'Asia/Shanghai' },
        true,
      ),
      ntp: section('ntp', 'timeserver', {
        enabled: '1',
        enable_server: '0',
        server: ['0.openwrt.pool.ntp.org', '1.openwrt.pool.ntp.org', '2.openwrt.pool.ntp.org'],
      }),
      led_wan: section('led_wan', 'led', {
        name: 'WAN',
        sysfs: 'green:wan',
        trigger: 'netdev',
        dev: 'pppoe-wan',
        mode: 'link tx rx',
      }),
    },
    network: {
      loopback: section('loopback', 'interface', {
        device: 'lo',
        proto: 'static',
        ipaddr: '127.0.0.1',
        netmask: '255.0.0.0',
      }),
      lan: section('lan', 'interface', {
        device: 'br-lan',
        proto: 'static',
        ipaddr: '192.168.8.1',
        netmask: '255.255.255.0',
      }),
      wan: section('wan', 'interface', { device: 'eth0', proto: 'pppoe', username: 'demo@isp' }),
      wan6: section('wan6', 'interface', { device: '@wan', proto: 'dhcpv6' }),
      wg0: section('wg0', 'interface', { proto: 'wireguard', addresses: ['10.8.0.1/24'] }),
      // An office network behind a second router on the LAN.
      cfg_route: section(
        'cfg_route',
        'route',
        { interface: 'lan', target: '10.10.0.0/16', gateway: '192.168.8.2', metric: '10' },
        true,
      ),
    },
    wireless: {
      radio0: section('radio0', 'wifi-device', {
        type: 'mac80211',
        band: '2g',
        channel: '6',
        htmode: 'HE20',
        country: 'CN',
        txpower: '20',
      }),
      radio1: section('radio1', 'wifi-device', {
        type: 'mac80211',
        band: '5g',
        channel: '36',
        htmode: 'HE80',
        country: 'CN',
      }),
      default_radio0: section('default_radio0', 'wifi-iface', {
        device: 'radio0',
        network: 'lan',
        mode: 'ap',
        ssid: 'RouteLink',
        encryption: 'sae-mixed',
        key: 'routelink-demo',
      }),
      default_radio1: section('default_radio1', 'wifi-iface', {
        device: 'radio1',
        network: 'lan',
        mode: 'ap',
        ssid: 'RouteLink-5G',
        encryption: 'sae-mixed',
        key: 'routelink-demo',
      }),
    },
    dhcp: {
      lan: section('lan', 'dhcp', { interface: 'lan', start: '100', limit: '150', leasetime: '12h' }),
      cfg_nas: section('cfg_nas', 'host', { name: 'NAS', mac: staticDev.mac, ip: staticDev.ip }, true),
    },
    firewall: {
      cfg_block: section(
        'cfg_block',
        'rule',
        {
          name: `RouteLink: block ${blockedDev.mac}`,
          src: '*',
          dest: '*',
          src_mac: [blockedDev.mac],
          proto: 'all',
          target: 'REJECT',
        },
        true,
      ),
      cfg_fwd: section(
        'cfg_fwd',
        'redirect',
        {
          name: 'NAS-HTTPS',
          src: 'wan',
          src_dport: '8443',
          dest: 'lan',
          dest_ip: staticDev.ip,
          dest_port: '443',
          target: 'DNAT',
        },
        true,
      ),
    },
  };

  const services: DemoState['services'] = {};
  for (const [name, enabled, running, start] of SERVICES) services[name] = { enabled, running, start };

  return {
    rng,
    bootTime: now - (3 * 86400 + 4 * 3600 + 23 * 60) * 1000,
    lastTick: now,
    counters: {
      'pppoe-wan': { rx: 182_334_120_000, tx: 21_448_210_000 },
      eth0: { rx: 183_120_440_000, tx: 21_902_310_000 },
      'br-lan': { rx: 20_118_440_000, tx: 176_224_810_000 },
      'phy0-ap0': { rx: 2_118_440_000, tx: 18_224_810_000 },
      'phy1-ap0': { rx: 12_118_440_000, tx: 141_224_810_000 },
      wg0: { rx: 318_440_000, tx: 1_224_810_000 },
    },
    wanRate: { rx: 5_000_000, tx: 750_000 },
    load: [0.32, 0.27, 0.21],
    devices,
    uci,
    services,
    syslog: buildSyslog(rng, devices),
    kernel: buildKernel(),
    agent: createDemoAgent(now),
    admin: createDemoAdmin(),
  };
}

/** Advances counters and load to `now`: a bounded random walk around ~40 Mbps down / ~6 Mbps up with spikes. */
export function tick(state: DemoState, now: number): void {
  const dt = Math.max(0, (now - state.lastTick) / 1000);
  if (dt === 0) return;
  state.lastTick = now;
  const rng = state.rng;
  const walk = (value: number, mean: number, spread: number) => {
    const spike = rng.next() < 0.05 ? mean * (1 + rng.next() * 2) : 0;
    const next = value + (mean - value) * 0.3 + (rng.next() - 0.5) * spread + spike;
    return Math.max(mean * 0.05, Math.min(mean * 4, next));
  };
  state.wanRate.rx = walk(state.wanRate.rx, 5_000_000, 2_500_000);
  state.wanRate.tx = walk(state.wanRate.tx, 750_000, 400_000);
  const rx = state.wanRate.rx * dt;
  const tx = state.wanRate.tx * dt;
  const add = (dev: string, r: number, t: number) => {
    state.counters[dev].rx += Math.round(r);
    state.counters[dev].tx += Math.round(t);
  };
  add('pppoe-wan', rx, tx);
  add('eth0', rx * 1.01, tx * 1.01);
  add('br-lan', tx, rx); // LAN sees the mirror image of WAN
  add('phy1-ap0', tx * 0.6, rx * 0.7);
  add('phy0-ap0', tx * 0.1, rx * 0.1);
  add('wg0', rx * 0.01, tx * 0.02);
  state.load = state.load.map((l, i) =>
    Math.max(0.02, Math.min(3, l + (rng.next() - 0.5) * (0.12 / (i + 1)))),
  ) as DemoState['load'];
}
