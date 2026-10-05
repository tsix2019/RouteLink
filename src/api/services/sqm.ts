import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import type { UbusCall } from '../ubus/types';
import { stageAndApply, uci, type UciSection, type UciValues } from '../uci';
import { parseInterfaces, pickWan, type RawInterface } from './network';

/** NW-10: sqm-scripts queues, the common settings only (LuCI has the rest). */

export const SQM_SCRIPTS = ['piece_of_cake.qos', 'layer_cake.qos', 'simple.qos', 'simplest.qos'] as const;
export type LinkLayer = 'none' | 'ethernet' | 'atm';
/** Per-packet overhead for the link layers offered here (sqm-scripts' documented values). */
const OVERHEAD: Record<Exclude<LinkLayer, 'none'>, number> = { ethernet: 38, atm: 44 };

export interface SqmQueue {
  section: string;
  enabled: boolean;
  interface: string;
  /** Mbit/s; 0 means not shaped. */
  download: number;
  upload: number;
  script: string;
  qdisc: string;
  linklayer: LinkLayer | string;
  overhead?: number;
  /** Shaping downloads right now: sqm's ifb4<interface> device exists. */
  active: boolean;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseSqm(values: Record<string, UciSection>, devices: string[]): SqmQueue[] {
  return Object.values(values)
    .filter((s) => s['.type'] === 'queue')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0))
    .map((s) => {
      const iface = String(s.interface ?? '');
      const q: SqmQueue = {
        section: s['.name'],
        enabled: s.enabled === '1',
        interface: iface,
        download: num(s.download) / 1000,
        upload: num(s.upload) / 1000,
        script: String(s.script ?? 'simple.qos'),
        qdisc: String(s.qdisc ?? 'fq_codel'),
        linklayer: String(s.linklayer ?? 'none'),
        active: devices.includes(`ifb4${iface}`),
      };
      if (s.overhead !== undefined && q.linklayer !== 'none') q.overhead = num(s.overhead);
      return q;
    });
}

export interface SqmInput {
  enabled: boolean;
  interface: string;
  /** Mbit/s as typed; decimals allowed. */
  download: string;
  upload: string;
  script: string;
  linklayer: LinkLayer;
}

export type SqmError = Partial<Record<keyof SqmInput, 'rate-invalid' | 'rate-required' | 'required'>>;

const rateOk = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

export function validateQueue(input: SqmInput): SqmError {
  const errors: SqmError = {};
  if (!input.interface) errors.interface = 'required';
  if (!rateOk(input.download)) errors.download = 'rate-invalid';
  if (!rateOk(input.upload)) errors.upload = 'rate-invalid';
  if (input.enabled && !errors.download && !errors.upload && !Number(input.download) && !Number(input.upload)) {
    errors.download = 'rate-required';
  }
  return errors;
}

const kbit = (mbit: string) => String(Math.round(Number(mbit.trim()) * 1000));

export function queueChanges(input: SqmInput, existing?: SqmQueue): UbusCall[] {
  const values: UciValues = {
    enabled: input.enabled ? '1' : '0',
    interface: input.interface,
    download: kbit(input.download),
    upload: kbit(input.upload),
    script: input.script,
    // The cake scripts require cake; the others work best with fq_codel.
    qdisc: input.script.includes('cake') ? 'cake' : 'fq_codel',
    linklayer: input.linklayer,
  };
  if (input.linklayer !== 'none') values.overhead = String(OVERHEAD[input.linklayer]);
  if (!existing) return [uci.add('sqm', 'queue', values, input.interface.replace(/[^A-Za-z0-9_]/g, '_'))];
  const changes = [uci.set('sqm', existing.section, values)];
  if (input.linklayer === 'none' && existing.overhead !== undefined) {
    changes.push(uci.delOption('sqm', existing.section, 'overhead'));
  }
  return changes;
}

export interface SqmState {
  installed: boolean;
  queues: SqmQueue[];
  /** Queueing disciplines the router has modules for. */
  qdiscs: string[];
  /** Network devices, for picking the interface. */
  devices: string[];
  /** The WAN's layer-3 device, the usual place for SQM. */
  wanDevice?: string;
}

export async function getSqm(conn: RouterConnection): Promise<SqmState> {
  const [config, qdiscs, devices, ifaces] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'sqm' } },
    { object: 'file', method: 'list', params: { path: '/var/run/sqm/available_qdiscs' } },
    { object: 'luci-rpc', method: 'getNetworkDevices' },
    { object: 'network.interface', method: 'dump' },
  ]);
  if (!config.ok) {
    if (config.error instanceof UbusError && config.error.code === 'NOT_FOUND') {
      return { installed: false, queues: [], qdiscs: [], devices: [] };
    }
    throw config.error;
  }
  const names = devices.ok ? Object.keys(devices.data as Record<string, unknown>).sort() : [];
  const wan = ifaces.ok
    ? pickWan(parseInterfaces((ifaces.data as { interface?: RawInterface[] }).interface ?? []))
    : undefined;
  const state: SqmState = {
    installed: true,
    queues: parseSqm((config.data as { values?: Record<string, UciSection> }).values ?? {}, names),
    qdiscs: qdiscs.ok ? ((qdiscs.data as { entries?: { name: string }[] }).entries ?? []).map((e) => e.name) : [],
    devices: names.filter((n) => n !== 'lo' && !n.startsWith('ifb')),
  };
  if (wan?.device) state.wanDevice = wan.device;
  return state;
}

/**
 * Shaping does not cut the LAN off, so this applies directly; the init script is enabled (it is not after
 * install on every release) and started, and uci's reload trigger picks up the new settings.
 */
export async function saveSqm(conn: RouterConnection, changes: UbusCall[]): Promise<void> {
  await stageAndApply(conn, changes, { mode: 'direct' });
  for (const action of ['enable', 'start']) {
    await conn.call('file', 'exec', { command: '/etc/init.d/sqm', params: [action] });
  }
}
