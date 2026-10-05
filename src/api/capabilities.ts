import type { RouterConnection } from './connection/types';
import type { UbusCall, UbusResult } from './ubus/types';

export type Feature =
  | 'clients.leases'
  | 'clients.neighbors'
  | 'clients.kick'
  | 'clients.wol.router'
  | 'wireless'
  | 'wireless.scan'
  | 'system.temperature'
  | 'services'
  | 'logs.system'
  | 'logs.kernel'
  | 'interfaces.control'
  | 'network.routes'
  | 'network.connections'
  | 'network.firewall'
  | 'network.wireguard'
  | 'system.processes'
  | 'system.cron'
  | 'system.leds'
  | 'system.time'
  | 'system.password'
  | 'network.wireguard.config'
  | 'network.openvpn'
  | 'network.ddns'
  | 'network.sqm'
  | 'network.adblock'
  | 'system.backup'
  | 'system.firmware'
  | 'system.reset'
  | 'system.sshkeys';

export type CapabilityState =
  | { status: 'ok' }
  /** The packages that provide the binary and/or the rpcd ACL (or the account lacks permission). */
  | { status: 'missing-package'; packages: string[] }
  /** Not available on this router at all (e.g. no radios, temperature on stock OpenWrt). */
  | { status: 'unsupported' };

export type Capabilities = Record<Feature, CapabilityState>;

interface Access {
  scope: 'ubus' | 'file' | 'uci' | 'cgi-io';
  object: string;
  fn: string;
}

interface Requirement {
  /** All of these must be granted... */
  access: Access[];
  /** ...or, instead, all of one of these alternative sets (older releases name things differently). */
  orAccess?: Access[][];
  /** Files that must exist (checked with `file stat`). */
  files?: string[];
  /** Empty: the feature is simply unsupported when unavailable. */
  packages: string[];
}

const ubus = (object: string, fn: string): Access => ({ scope: 'ubus', object, fn });
const file = (object: string, fn = 'exec'): Access => ({ scope: 'file', object, fn });
const uciConfig = (object: string, fn: 'read' | 'write'): Access => ({ scope: 'uci', object, fn });

const REQUIREMENTS: Record<Exclude<Feature, 'wireless'>, Requirement> = {
  'clients.leases': { access: [ubus('luci-rpc', 'getDHCPLeases')], packages: ['rpcd-mod-luci'] },
  'clients.neighbors': { access: [file('/sbin/ip -4 neigh show')], packages: ['luci-mod-status'] },
  'clients.kick': { access: [ubus('hostapd.*', 'del_client')], packages: ['luci-mod-status'] },
  // Up to 24.10 through `file exec`; from 25.12 through LuCI's `luci.wol` object.
  'clients.wol.router': {
    access: [file('/usr/bin/etherwake')],
    orAccess: [[ubus('luci.wol', 'exec')]],
    files: ['/usr/bin/etherwake'],
    packages: ['etherwake', 'luci-app-wol'],
  },
  'wireless.scan': { access: [ubus('iwinfo', 'scan')], packages: ['rpcd-mod-iwinfo'] },
  'system.temperature': { access: [ubus('luci', 'getTempInfo')], packages: [] },
  // 24.10: rc list/init. 23.05: LuCI's own init helpers.
  services: {
    access: [ubus('rc', 'list'), ubus('rc', 'init')],
    orAccess: [[ubus('luci', 'getInitList'), ubus('luci', 'setInitAction')]],
    packages: ['rpcd'],
  },
  // 24.10: LuCI's syslog wrapper. 23.05: logread with LuCI's exact arguments.
  'logs.system': {
    access: [file('/usr/libexec/syslog-wrapper')],
    orAccess: [[file('/sbin/logread -e ^')]],
    packages: ['luci-mod-status'],
  },
  'logs.kernel': { access: [file('/bin/dmesg -r')], packages: ['luci-mod-status'] },
  'interfaces.control': { access: [file('/sbin/ifup'), file('/sbin/ifdown')], packages: ['luci-mod-network'] },
  // M2: what LuCI's status, system, firewall and WireGuard pages are granted (checked on 23.05–25.12).
  'network.routes': { access: [file('/sbin/ip -4 route show table all')], packages: ['luci-mod-status'] },
  'network.connections': { access: [ubus('luci', 'getConntrackList')], packages: ['luci-mod-status'] },
  'network.firewall': { access: [uciConfig('firewall', 'write')], packages: ['luci-app-firewall'] },
  'network.wireguard': { access: [ubus('luci.wireguard', 'getWgInstances')], packages: ['luci-proto-wireguard'] },
  'system.processes': { access: [ubus('luci', 'getProcessList'), file('/bin/kill')], packages: ['luci-mod-status'] },
  'system.cron': {
    access: [file('/etc/crontabs/root', 'write'), file('/etc/init.d/cron reload')],
    packages: ['luci-mod-system'],
  },
  'system.leds': { access: [ubus('luci', 'getLEDs')], packages: ['luci-mod-system'] },
  'system.time': {
    access: [ubus('luci', 'getTimezones'), ubus('luci', 'setLocaltime')],
    packages: ['luci-mod-system'],
  },
  'system.password': { access: [ubus('luci', 'setPassword')], packages: ['luci-mod-system'] },
  // M3. Keys for new tunnels and peers come from luci-proto-wireguard as well.
  'network.wireguard.config': {
    access: [ubus('luci.wireguard', 'generateKeyPair'), uciConfig('network', 'write')],
    packages: ['luci-proto-wireguard'],
  },
  'network.openvpn': {
    access: [uciConfig('openvpn', 'write'), file('/etc/openvpn/routelink.ovpn', 'write')],
    packages: ['openvpn-openssl', 'luci-app-openvpn'],
  },
  'network.ddns': {
    access: [ubus('luci.ddns', 'get_services_status'), uciConfig('ddns', 'write')],
    packages: ['ddns-scripts', 'luci-app-ddns'],
  },
  'network.sqm': {
    access: [uciConfig('sqm', 'write'), file('/etc/init.d/sqm enable')],
    packages: ['sqm-scripts', 'luci-app-sqm'],
  },
  // adblock-fast (preferred) or adblock.
  'network.adblock': {
    access: [ubus('luci.adblock-fast', 'getInitStatus'), ubus('luci.adblock-fast', 'setInitAction')],
    orAccess: [[uciConfig('adblock', 'write'), file('/etc/init.d/adblock restart')]],
    packages: ['adblock-fast', 'luci-app-adblock-fast'],
  },
  'system.backup': {
    access: [
      { scope: 'cgi-io', object: 'backup', fn: 'read' },
      file('/tmp/backup.tar.gz', 'write'),
      file('/sbin/sysupgrade --restore-backup /tmp/backup.tar.gz'),
    ],
    packages: ['luci-mod-system'],
  },
  'system.firmware': {
    access: [
      file('/tmp/firmware.bin', 'write'),
      ubus('system', 'validate_firmware_image'),
      file('/sbin/sysupgrade /tmp/firmware.bin'),
    ],
    packages: ['luci-mod-system'],
  },
  'system.reset': { access: [file('/sbin/firstboot -r -y')], packages: ['luci-mod-system'] },
  // M4: installing the app's SSH key. Routers running OpenSSH instead of dropbear do not get the option.
  'system.sshkeys': {
    access: [file('/etc/dropbear/authorized_keys', 'read'), file('/etc/dropbear/authorized_keys', 'write')],
    files: ['/usr/sbin/dropbear'],
    packages: ['dropbear', 'luci-mod-system'],
  },
};

const accessKey = (a: Access) => `${a.scope}|${a.object}|${a.fn}`;

/** All checks run in one batch: session access per requirement, file stats, and the radio list. */
export async function detectCapabilities(conn: RouterConnection): Promise<Capabilities> {
  const accesses = new Map<string, Access>();
  const files = new Set<string>();
  for (const req of Object.values(REQUIREMENTS)) {
    [req.access, ...(req.orAccess ?? [])].flat().forEach((a) => accesses.set(accessKey(a), a));
    req.files?.forEach((f) => files.add(f));
  }
  const accessList = [...accesses.values()];
  const fileList = [...files];
  const calls: UbusCall[] = [
    { object: 'luci-rpc', method: 'getWirelessDevices' },
    ...accessList.map((a) => ({
      object: 'session',
      method: 'access',
      params: { scope: a.scope, object: a.object, function: a.fn },
    })),
    ...fileList.map((path) => ({ object: 'file', method: 'stat', params: { path } })),
  ];
  const results = await conn.batch(calls);

  const granted = new Map<string, boolean>();
  accessList.forEach((a, i) => {
    const r = results[1 + i] as UbusResult<{ access?: boolean }>;
    granted.set(accessKey(a), r.ok && r.data.access === true);
  });
  const present = new Map<string, boolean>();
  fileList.forEach((f, i) => present.set(f, results[1 + accessList.length + i].ok));

  const radios = results[0] as UbusResult<Record<string, unknown>>;
  const caps = {
    wireless: radios.ok && Object.keys(radios.data).length > 0 ? { status: 'ok' } : { status: 'unsupported' },
  } as Capabilities;

  for (const [feature, req] of Object.entries(REQUIREMENTS) as [Exclude<Feature, 'wireless'>, Requirement][]) {
    const allGranted = (set: Access[]) => set.every((a) => granted.get(accessKey(a)));
    const available =
      (allGranted(req.access) || (req.orAccess ?? []).some(allGranted)) &&
      (req.files ?? []).every((f) => present.get(f));
    caps[feature] = available
      ? { status: 'ok' }
      : req.packages.length
        ? { status: 'missing-package', packages: req.packages }
        : { status: 'unsupported' };
  }
  // Scanning needs radios too.
  if (caps.wireless.status !== 'ok') caps['wireless.scan'] = { status: 'unsupported' };
  return caps;
}

export const isAvailable = (caps: Capabilities | undefined, feature: Feature): boolean =>
  caps?.[feature]?.status === 'ok';
