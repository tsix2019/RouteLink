import { AUTHORIZED_KEYS } from '../../services/ssh-keys';
import { UbusError } from '../../ubus/errors';
import type { UciSection } from '../../uci';
import { adminHandlers, demoKill, demoLocaltime } from './admin';
import { agentHandlers } from './agent';
import { controlAgentHandlers } from './control';
import { diagAgentHandlers, diagCommands } from './diag';
import { demoConntrack, demoReverseDns } from './connections';
import { addonHandlers, demoAddonFile, demoAddonList, demoSqmDevices } from './addons';
import { DEMO_MOUNTS, demoMaintenanceWrite, demoValidateFirmware, maintenanceCommands } from './maintenance';
import { demoIpRoute, demoKey, demoPublicKey, demoWireGuard } from './routing';
import type { DemoState } from './state';
import { hostapdHandler as wifiHostapd, wifiAgentHandlers, wirelessHandlers } from './wifi';

type Params = Record<string, unknown>;
export type Handler = (state: DemoState, params: Params, now: number) => unknown;

const CRONTAB = '/etc/crontabs/root';
const LAN_MAC = '94:83:C4:00:00:10';
const WAN_MAC = '94:83:C4:00:00:11';
const uptime = (state: DemoState, now: number) => Math.floor((now - state.bootTime) / 1000);

function iface(name: string, proto: string, device: string, extra: Record<string, unknown>, upSince: number) {
  return {
    interface: name,
    up: true,
    pending: false,
    available: true,
    autostart: true,
    dynamic: false,
    uptime: upSince,
    l3_device: device,
    proto,
    device,
    'ipv4-address': [],
    'ipv6-address': [],
    'ipv6-prefix-assignment': [],
    route: [],
    'dns-server': [],
    'dns-search': [],
    ...extra,
  };
}

function nextSectionName(config: Record<string, UciSection>): string {
  let n = Object.keys(config).length;
  while (config[`cfg${n.toString(16).padStart(6, '0')}`]) n++;
  return `cfg${n.toString(16).padStart(6, '0')}`;
}

const files: Record<
  string,
  (s: DemoState, args: string[], now: number) => { code: number; stdout?: string; stderr?: string }
> = {
  '/sbin/ip': (s, args, now) => {
    const command = args.join(' ');
    if (command === '-4 route show table all') return { code: 0, stdout: demoIpRoute(s, 4) };
    if (command === '-6 route show table all') return { code: 0, stdout: demoIpRoute(s, 6) };
    if (command !== '-4 neigh show') return { code: 1, stderr: 'unsupported' };
    const lines = s.devices.map((d) => {
      const reachable = d.online && !(d.bannedUntil && d.bannedUntil > now);
      return `${d.ip} dev br-lan lladdr ${d.mac.toLowerCase()} ref 1 used 0/0/0 probes 1 ${reachable ? 'REACHABLE' : 'FAILED'}`;
    });
    return { code: 0, stdout: `${lines.join('\n')}\n` };
  },
  '/usr/libexec/syslog-wrapper': (s) => ({ code: 0, stdout: `${s.syslog.join('\n')}\n` }),
  '/bin/dmesg': (s) => ({ code: 0, stdout: `${s.kernel.join('\n')}\n` }),
  '/sbin/reboot': (s, _args, now) => {
    s.rebootingUntil = now + 8_000;
    return { code: 0 };
  },
  '/bin/kill': (s, args) => demoKill(s, args),
  ...diagCommands('gateway'),
  ...maintenanceCommands,
  '/etc/init.d/cron': (_s, args) => (args[0] === 'reload' ? { code: 0 } : { code: 1, stderr: 'unsupported' }),
  '/etc/init.d/sqm': (s, args) => {
    if (!s.services.sqm || !['enable', 'start'].includes(args[0])) return { code: 1, stderr: 'unsupported' };
    if (args[0] === 'enable') s.services.sqm.enabled = true;
    else s.services.sqm.running = true;
    return { code: 0 };
  },
  '/sbin/ifup': () => ({ code: 0 }),
  '/sbin/ifdown': () => ({ code: 0 }),
  '/usr/bin/etherwake': (s, args) => {
    const mac = args[args.length - 1]?.toUpperCase();
    const d = s.devices.find((x) => x.mac === mac);
    if (d) d.online = true;
    return { code: 0 };
  },
};

export const handlers: Record<string, Handler> = {
  'session.access': () => ({ access: true }),
  'file.stat': (s, p) => {
    const files: Record<string, number> = {
      '/usr/bin/etherwake': 10512,
      '/usr/libexec/package-manager-call': 2391,
      '/usr/sbin/dropbear': 223_648,
      ...(s.agent.installed ? { '/usr/sbin/routelinkd': 92_416 } : {}),
    };
    const size = files[String(p.path)];
    return size ? { path: p.path, type: 'file', size } : notFound('file.stat');
  },
  'file.list': (_s, p) =>
    demoAddonList(String(p.path)) !== null
      ? { entries: demoAddonList(String(p.path)) }
      : p.path === '/sys/devices/system/cpu'
        ? { entries: ['cpu0', 'cpu1', 'cpu2', 'cpu3', 'cpufreq'].map((name) => ({ name, type: 'directory' })) }
        : p.path === '/var/opkg-lists'
          ? {
              entries: ['openwrt_base', 'openwrt_core', 'openwrt_luci', 'openwrt_packages'].map((name) => ({
                name,
                type: 'file',
              })),
            }
          : { entries: [] },
  'file.read': (s, p) =>
    p.path === '/proc/mounts'
      ? { data: DEMO_MOUNTS }
      : demoAddonFile(String(p.path)) !== null
        ? { data: demoAddonFile(String(p.path)) }
        : p.path === CRONTAB
          ? { data: s.admin.crontab }
          : p.path === AUTHORIZED_KEYS && s.ssh.authorizedKeys
            ? { data: s.ssh.authorizedKeys }
            : p.path === '/etc/opkg/distfeeds.conf'
              ? {
                  data: ['core', 'base', 'luci', 'packages']
                    .map((feed) =>
                      feed === 'core'
                        ? 'src/gz openwrt_core https://downloads.openwrt.org/releases/24.10.8/targets/mediatek/filogic/packages'
                        : `src/gz openwrt_${feed} https://downloads.openwrt.org/releases/24.10.8/packages/aarch64_cortex-a53/${feed}`,
                    )
                    .join('\n'),
                }
              : notFound('file.read'),
  'file.write': (s, p) => {
    if (p.path === CRONTAB) {
      s.admin.crontab = String(p.data ?? '');
      return {};
    }
    if (p.path === AUTHORIZED_KEYS) {
      s.ssh.authorizedKeys = String(p.data ?? '');
      return {};
    }
    const size = typeof p.data === 'string' ? Math.floor((p.data.length * 3) / 4) : 0;
    if (demoMaintenanceWrite(s, String(p.path), p.append === true, size)) return {};
    if (String(p.path).startsWith('/etc/openvpn/')) {
      s.vpn.files[String(p.path)] = String(p.data ?? '');
      return {};
    }
    // Plugin uploads (package installs) and the apk key: accepted and dropped.
    if (String(p.path).startsWith('/tmp/upload.') || String(p.path).startsWith('/etc/apk/keys/')) return {};
    return notFound('file.write');
  },
  'file.remove': (s, p) => {
    if (!(String(p.path) in s.vpn.files)) return notFound('file.remove');
    delete s.vpn.files[String(p.path)];
    return {};
  },
  /** procd's view: OpenVPN instances run while they are enabled. */
  'service.list': (s, p) => {
    const instances = Object.values(s.uci.openvpn ?? {})
      .filter((x) => x['.type'] === 'openvpn' && x.enabled === '1')
      .map((x, i) => [x['.name'], { running: true, pid: 3100 + i }]);
    const all = { openvpn: { instances: Object.fromEntries(instances) } };
    return p.name ? (p.name === 'openvpn' ? all : {}) : all;
  },
  'file.exec': (s, p, now) => {
    const run = files[String(p.command)];
    if (!run) throw new UbusError('PERMISSION_DENIED', 'file.exec');
    return run(s, (p.params as string[] | undefined) ?? [], now);
  },

  'system.board': () => ({
    kernel: '6.6.104',
    hostname: 'RouteLink-Demo',
    system: 'ARMv8 Processor rev 4',
    model: 'OpenWrt One',
    board_name: 'openwrt,one',
    rootfs_type: 'squashfs',
    release: {
      distribution: 'OpenWrt',
      version: '24.10.8',
      revision: 'r29233-443ec4032a',
      target: 'mediatek/filogic',
      description: 'OpenWrt 24.10.8 r29233-443ec4032a',
    },
  }),
  'system.info': (s, _p, now) => ({
    localtime: demoLocaltime(s, now),
    uptime: uptime(s, now),
    load: s.load.map((l) => Math.round(l * 65536)),
    memory: {
      total: 1_048_576_000,
      free: 512_000_000,
      shared: 2_000_000,
      buffered: 0,
      available: 640_000_000,
      cached: 140_000_000,
    },
    root: { total: 223_744, free: 181_248, used: 42_496, avail: 176_128 },
    tmp: { total: 512_000, free: 509_440, used: 2_560, avail: 509_440 },
    swap: { total: 0, free: 0 },
  }),
  'luci.getTempInfo': (s) => ({ cpu: 46_500 + Math.round(s.load[0] * 4_000) }),
  'system.validate_firmware_image': (s) => demoValidateFirmware(s) ?? notFound('system.validate_firmware_image'),
  'luci-rpc.getBoardJSON': () => ({
    model: { id: 'openwrt,one', name: 'OpenWrt One' },
    network: { lan: { device: 'eth1', protocol: 'static' }, wan: { device: 'eth0', protocol: 'pppoe' } },
  }),

  'network.interface.dump': (s, _p, now) => {
    const up = uptime(s, now) - 12;
    return {
      interface: [
        iface(
          'lan',
          'static',
          'br-lan',
          {
            'ipv4-address': [{ address: '192.168.8.1', mask: 24 }],
            'ipv6-prefix-assignment': [
              { address: 'fd00:8::', mask: 64, 'local-address': { address: 'fd00:8::1', mask: 64 } },
            ],
          },
          up,
        ),
        iface(
          'wan',
          'pppoe',
          'pppoe-wan',
          {
            'ipv4-address': [{ address: '203.0.113.45', mask: 32 }],
            route: [{ target: '0.0.0.0', mask: 0, nexthop: '203.0.113.1', source: '203.0.113.45/32' }],
            'dns-server': ['223.5.5.5', '119.29.29.29'],
          },
          up,
        ),
        iface(
          'wan6',
          'dhcpv6',
          'pppoe-wan',
          { 'ipv6-address': [{ address: '2001:db8:45::1', mask: 64 }], 'dns-server': ['2400:3200::1'] },
          up,
        ),
        iface('wg0', 'wireguard', 'wg0', { 'ipv4-address': [{ address: '10.8.0.1', mask: 24 }] }, up - 30),
      ],
    };
  },
  'luci-rpc.getNetworkDevices': (s) => {
    const dev = (name: string, mac: string | undefined, extra: Record<string, unknown> = {}) => ({
      name,
      up: true,
      mac,
      stats: { rx_bytes: s.counters[name]?.rx ?? 0, tx_bytes: s.counters[name]?.tx ?? 0 },
      ...extra,
    });
    return {
      eth0: dev('eth0', WAN_MAC, { link: { speed: 2500, duplex: 'full', carrier: true } }),
      'pppoe-wan': dev('pppoe-wan', undefined),
      'br-lan': dev('br-lan', LAN_MAC, { link: { speed: 1000, duplex: 'full', carrier: true } }),
      'phy0-ap0': dev('phy0-ap0', '94:83:C4:00:00:01', { wireless: true }),
      'phy1-ap0': dev('phy1-ap0', '94:83:C4:00:00:02', { wireless: true }),
      wg0: dev('wg0', undefined),
      ...Object.fromEntries(demoSqmDevices(s).map((name) => [name, dev(name, undefined)])),
    };
  },
  'luci-rpc.getDHCPLeases': (s) => ({
    dhcp_leases: s.devices
      .filter((d) => d.online)
      .map((d, i) => ({ hostname: d.hostname, ipaddr: d.ip, macaddr: d.mac.toLowerCase(), expires: 20_000 + i * 977 })),
    dhcp6_leases: [],
  }),
  'luci-rpc.getHostHints': (s) =>
    Object.fromEntries(s.devices.map((d) => [d.mac, { ipaddrs: [d.ip], ip6addrs: [], name: d.hostname }])),
  ...wirelessHandlers('gateway'),
  ...wifiAgentHandlers('gateway'),

  ...uciHandlers((s) => s.uci),

  ...agentHandlers,
  ...diagAgentHandlers,
  ...controlAgentHandlers,
  ...adminHandlers,
  ...addonHandlers,
  'luci.getConntrackList': (s, _p, now) => demoConntrack(s, now),
  'network.rrdns.lookup': (s, p) => demoReverseDns(s, p.addrs),
  'luci.wireguard.getWgInstances': (s, _p, now) => demoWireGuard(s, now),
  'luci.wireguard.generateKeyPair': (s, _p, now) => {
    const priv = demoKey(`priv:${now}:${++s.vpn.keys}`);
    return { keys: { priv, pub: demoPublicKey(priv) } };
  },
  'luci.wireguard.generatePsk': (s, _p, now) => ({ psk: demoKey(`psk:${now}:${++s.vpn.keys}`) }),
  'luci.wireguard.getPublicAndPrivateKeyFromPrivate': (_s, p) => ({
    keys: { priv: String(p.privkey), pub: demoPublicKey(String(p.privkey)) },
  }),

  'rc.list': (s) => s.services,
  'rc.init': (s, p) => {
    const svc = s.services[String(p.name)];
    if (!svc) return notFound('rc.init');
    switch (p.action) {
      case 'start':
      case 'restart':
      case 'reload':
        svc.running = true;
        break;
      case 'stop':
        svc.running = false;
        break;
      case 'enable':
        svc.enabled = true;
        break;
      case 'disable':
        svc.enabled = false;
        break;
    }
    return {};
  },
};

/** hostapd objects of the gateway's interfaces ("hostapd.phy1-ap0"). */
export const hostapdHandler = (object: string): Handler | undefined => wifiHostapd(object, 'gateway');

/** uci over one config store (the gateway's, or the demo AP's). */
export function uciHandlers(
  store: (s: DemoState) => Record<string, Record<string, UciSection>>,
): Record<string, Handler> {
  return {
    'uci.get': (s, p) => {
      const config = store(s)[String(p.config)];
      if (!config) return notFound('uci.get');
      return p.section ? { values: config[String(p.section)] } : { values: config };
    },
    'uci.set': (s, p) => {
      const config = store(s)[String(p.config)];
      const sec = config?.[String(p.section)];
      if (!sec) return notFound('uci.set');
      Object.assign(sec, p.values);
      return {};
    },
    'uci.add': (s, p) => {
      const config = (store(s)[String(p.config)] ??= {});
      const name = typeof p.name === 'string' ? p.name : nextSectionName(config);
      config[name] = {
        '.name': name,
        '.type': String(p.type),
        '.anonymous': !p.name,
        ...(p.values as object),
      } as UciSection;
      return { section: name };
    },
    'uci.delete': (s, p) => {
      const config = store(s)[String(p.config)];
      const sec = config?.[String(p.section)];
      if (!sec) return notFound('uci.delete');
      if (p.option) delete sec[String(p.option)];
      else delete config[String(p.section)];
      return {};
    },
    // Demo edits are applied on staging; there is nothing to revert or roll back.
    'uci.revert': () => ({}),
    'uci.apply': () => ({}),
    'uci.confirm': () => ({}),
    'uci.changes': () => ({ changes: {} }),
  };
}

function notFound(call: string, code: 'NOT_FOUND' | 'NO_DATA' = 'NOT_FOUND'): never {
  throw new UbusError(code, call);
}
