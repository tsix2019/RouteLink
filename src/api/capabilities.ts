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
  | 'interfaces.control';

export type CapabilityState =
  | { status: 'ok' }
  /** The packages that provide the binary and/or the rpcd ACL (or the account lacks permission). */
  | { status: 'missing-package'; packages: string[] }
  /** Not available on this router at all (e.g. no radios, temperature on stock OpenWrt). */
  | { status: 'unsupported' };

export type Capabilities = Record<Feature, CapabilityState>;

interface Access {
  scope: 'ubus' | 'file';
  object: string;
  fn: string;
}

interface Requirement {
  access: Access[];
  /** Files that must exist (checked with `file stat`). */
  files?: string[];
  /** Empty: the feature is simply unsupported when unavailable. */
  packages: string[];
}

const ubus = (object: string, fn: string): Access => ({ scope: 'ubus', object, fn });
const file = (object: string, fn = 'exec'): Access => ({ scope: 'file', object, fn });

const REQUIREMENTS: Record<Exclude<Feature, 'wireless'>, Requirement> = {
  'clients.leases': { access: [ubus('luci-rpc', 'getDHCPLeases')], packages: ['rpcd-mod-luci'] },
  'clients.neighbors': { access: [file('/sbin/ip -4 neigh show')], packages: ['luci-mod-status'] },
  'clients.kick': { access: [ubus('hostapd.*', 'del_client')], packages: ['luci-mod-status'] },
  'clients.wol.router': {
    access: [file('/usr/bin/etherwake')],
    files: ['/usr/bin/etherwake'],
    packages: ['etherwake', 'luci-app-wol'],
  },
  'wireless.scan': { access: [ubus('iwinfo', 'scan')], packages: ['rpcd-mod-iwinfo'] },
  'system.temperature': { access: [ubus('luci', 'getTempInfo')], packages: [] },
  services: { access: [ubus('rc', 'list'), ubus('rc', 'init')], packages: ['rpcd'] },
  'logs.system': { access: [file('/usr/libexec/syslog-wrapper')], packages: ['luci-mod-status'] },
  'logs.kernel': { access: [file('/bin/dmesg -r')], packages: ['luci-mod-status'] },
  'interfaces.control': { access: [file('/sbin/ifup'), file('/sbin/ifdown')], packages: ['luci-mod-network'] },
};

const accessKey = (a: Access) => `${a.scope}|${a.object}|${a.fn}`;

/** All checks run in one batch: session access per requirement, file stats, and the radio list. */
export async function detectCapabilities(conn: RouterConnection): Promise<Capabilities> {
  const accesses = new Map<string, Access>();
  const files = new Set<string>();
  for (const req of Object.values(REQUIREMENTS)) {
    req.access.forEach((a) => accesses.set(accessKey(a), a));
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
    const available =
      req.access.every((a) => granted.get(accessKey(a))) && (req.files ?? []).every((f) => present.get(f));
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
