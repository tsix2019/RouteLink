import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection } from '../uci';
import type { UbusCall } from '../ubus/types';
import { ActionError } from './action-error';

/**
 * NW-3: the "ports × VLANs" matrix, for DSA bridges (`bridge-vlan` sections, netifd's VLAN filtering on any
 * Linux bridge) and for swconfig switches (`switch_vlan`). Changes always go through a rollback apply.
 */

export type PortMode = 'off' | 'untagged' | 'tagged';
export interface VlanMember {
  mode: PortMode;
  /** DSA: this VLAN is the port's primary VLAN (`*`); swconfig has no separate flag. */
  pvid: boolean;
}

export interface VlanPort {
  /** DSA: the port's device name; swconfig: the switch port number. */
  id: string;
  label: string;
  cpu: boolean;
  /** swconfig CPU ports: the network device behind them. */
  device?: string;
  /** swconfig: the port can only be a tagged member. */
  needTag?: boolean;
}

export interface Vlan {
  /** Absent for a VLAN that is not saved yet. */
  section?: string;
  id: number;
  /** Keyed by VlanPort.id; ports that are not members may be missing. */
  members: Record<string, VlanMember>;
  /** Interfaces whose device is this VLAN. */
  usedBy: string[];
}

export interface DsaVlans {
  kind: 'dsa';
  bridge: string;
  deviceSection: string;
  /** VLAN filtering is on (LuCI's flag, or bridge-vlan sections exist). */
  filtering: boolean;
  ports: VlanPort[];
  vlans: Vlan[];
  /** Interfaces on the bridge itself (moved to VLAN 1 when filtering is switched on). */
  bridgeUsers: string[];
}

export interface SwitchVlans {
  kind: 'swconfig';
  switchName: string;
  switchSection: string;
  ports: VlanPort[];
  vlans: Vlan[];
  /** swconfig table index of each saved VLAN, by section. */
  indexes: Record<string, number>;
  /** Option that holds the VLAN ID when it differs from the table index ("vid"), or null. */
  vidOption: string | null;
  vlan4kOption: string | null;
  minVid: number;
  maxVid: number;
}

export type VlanState = DsaVlans | SwitchVlans | { kind: 'none' };

/** The parts of `luci-rpc getBoardJSON` used here. */
export interface BoardJson {
  switch?: Record<
    string,
    {
      enable?: boolean;
      reset?: boolean;
      ports?: {
        num: number;
        role?: string;
        index?: number;
        device?: string;
        need_tag?: boolean;
        want_untag?: boolean;
      }[];
    }
  >;
  [key: string]: unknown;
}

/** `luci getSwconfigFeatures` */
export interface SwconfigFeatures {
  vid_option?: string;
  vlan4k_option?: string;
  min_vid?: number;
  max_vid?: number;
  num_vlans?: number;
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((x) => String(x).split(/\s+/)).filter(Boolean);
const byIndex = (a: UciSection, b: UciSection) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0);
const off: VlanMember = { mode: 'off', pvid: false };

/** Interfaces whose device (or legacy ifname list) is `dev`. */
function usersOf(sections: UciSection[], dev: string): string[] {
  return sections
    .filter((s) => s['.type'] === 'interface' && (s.device === dev || list(s.ifname).includes(dev)))
    .map((s) => s['.name']);
}

// ---- DSA ----

function parseDsa(sections: UciSection[]): DsaVlans | null {
  const bridges = sections.filter((s) => s['.type'] === 'device' && s.type === 'bridge' && s.name);
  const lan = sections.find((s) => s['.type'] === 'interface' && s['.name'] === 'lan');
  const lanDev = String(lan?.device ?? '');
  const dev =
    bridges.find((b) => lanDev === b.name || lanDev.startsWith(`${String(b.name)}.`)) ??
    bridges.find((b) => list(b.ports).length > 0);
  if (!dev) return null;
  const bridge = String(dev.name);
  const portIds = list(dev.ports);
  const bvs = sections.filter((s) => s['.type'] === 'bridge-vlan' && s.device === bridge);
  const vlans: Vlan[] = bvs.map((s) => {
    const id = Number(s.vlan);
    const members: Record<string, VlanMember> = {};
    for (const entry of list(s.ports)) {
      const [port, flags = ''] = entry.split(':');
      members[port] = { mode: flags.includes('u') ? 'untagged' : 'tagged', pvid: flags.includes('*') };
      if (!portIds.includes(port)) portIds.push(port);
    }
    return { section: s['.name'], id, members, usedBy: usersOf(sections, `${bridge}.${id}`) };
  });
  for (const v of vlans) for (const p of portIds) v.members[p] ??= { ...off };
  return {
    kind: 'dsa',
    bridge,
    deviceSection: dev['.name'],
    filtering: dev.vlan_filtering === '1' || bvs.length > 0,
    ports: portIds.map((id) => ({ id, label: id, cpu: false })),
    vlans: vlans.sort((a, b) => a.id - b.id),
    bridgeUsers: usersOf(sections, bridge),
  };
}

const dsaPorts = (s: DsaVlans, v: Vlan): string[] =>
  s.ports.flatMap((p) => {
    const m = v.members[p.id];
    if (!m || m.mode === 'off') return [];
    return [`${p.id}:${m.mode === 'untagged' ? 'u' : 't'}${m.pvid ? '*' : ''}`];
  });

// ---- swconfig ----

/** Port labels as LuCI makes them from board.json: "CPU (eth0)", "LAN 1" … by index, "WAN". */
function switchPorts(
  layout: NonNullable<BoardJson['switch']>[string] | undefined,
  sections: UciSection[],
  name: string,
) {
  const specs = (layout?.ports ?? [])
    .filter((p) => typeof p.num === 'number' && (typeof p.role === 'string' || typeof p.device === 'string'))
    .map((p) => ({ ...p, role: p.role ?? 'cpu', index: p.index ?? p.num }));
  if (!specs.length) {
    // Unknown topology: whatever the VLANs mention, CPU ports recognisable by their "t".
    const nums = new Set<number>();
    for (const s of sections)
      if (s['.type'] === 'switch_vlan' && s.device === name) for (const t of list(s.ports)) nums.add(parseInt(t, 10));
    return [...nums]
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b)
      .map((n): VlanPort => ({ id: String(n), label: `Port ${n}`, cpu: false }));
  }
  specs.sort((a, b) => a.role.localeCompare(b.role) || a.index - b.index);
  const counts = new Map<string, number>();
  for (const s of specs) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
  const seen = new Map<string, number>();
  return specs.map((s): VlanPort => {
    const n = (seen.get(s.role) ?? 0) + 1;
    seen.set(s.role, n);
    const label =
      s.role === 'cpu'
        ? `CPU (${s.device})`
        : counts.get(s.role)! > 1
          ? `${s.role.toUpperCase()} ${n}`
          : s.role.toUpperCase();
    const port: VlanPort = { id: String(s.num), label, cpu: !!s.device };
    if (s.device) port.device = s.device;
    if (s.need_tag) port.needTag = true;
    return port;
  });
}

function parseSwitch(sections: UciSection[], board: BoardJson, features: SwconfigFeatures): SwitchVlans | null {
  const sw = sections.find((s) => s['.type'] === 'switch');
  if (!sw) return null;
  const name = String(sw.name ?? sw['.name']);
  const ports = switchPorts(board.switch?.[name], sections, name);
  const vidOption = features.vid_option ?? null;
  const indexes: Record<string, number> = {};
  const vlans = sections
    .filter((s) => s['.type'] === 'switch_vlan' && s.device === name)
    .map((s): Vlan => {
      const index = Number(s.vlan);
      const id = vidOption && s[vidOption] !== undefined ? Number(s[vidOption]) : index;
      indexes[s['.name']] = index;
      const members: Record<string, VlanMember> = Object.fromEntries(ports.map((p) => [p.id, { ...off }]));
      const devices: string[] = [];
      for (const token of list(s.ports)) {
        const m = /^(\d+)([tu]?)/.exec(token);
        if (!m) continue;
        const tagged = m[2] === 't';
        members[m[1]] = { mode: tagged ? 'tagged' : 'untagged', pvid: false };
        const cpu = ports.find((p) => p.id === m[1] && p.device);
        if (cpu?.device) devices.push(tagged ? `${cpu.device}.${id}` : cpu.device);
      }
      return { section: s['.name'], id, members, usedBy: devices.flatMap((d) => usersOf(sections, d)) };
    })
    .sort((a, b) => a.id - b.id);
  return {
    kind: 'swconfig',
    switchName: name,
    switchSection: sw['.name'],
    ports,
    vlans,
    indexes,
    vidOption,
    vlan4kOption: features.vlan4k_option ?? null,
    minVid: Math.max(1, features.min_vid ?? 1),
    maxVid: vidOption ? 4094 : (features.num_vlans ?? 16) - 1,
  };
}

/** Non-CPU ports by number, then the CPU ports; LuCI writes them the same way. */
function switchPortsString(s: SwitchVlans, v: Vlan): string {
  const ordered = [...s.ports].sort((a, b) => Number(a.cpu) - Number(b.cpu) || Number(a.id) - Number(b.id));
  return ordered
    .flatMap((p) => {
      const m = v.members[p.id];
      if (!m || m.mode === 'off') return [];
      return [`${p.id}${m.mode === 'tagged' ? 't' : ''}`];
    })
    .join(' ');
}

// ---- both ----

export function parseVlans(
  values: Record<string, UciSection>,
  board: BoardJson,
  features: SwconfigFeatures = {},
): VlanState {
  const sections = Object.values(values).sort(byIndex);
  return parseSwitch(sections, board, features) ?? parseDsa(sections) ?? { kind: 'none' };
}

export type VlanError =
  | { code: 'id-range' | 'id-duplicate' | 'empty'; vlan: number }
  | { code: 'multiple-untagged' | 'multiple-pvid' | 'needs-tag'; port: string };

export function validateVlans(state: DsaVlans | SwitchVlans, vlans: Vlan[]): VlanError[] {
  const errors: VlanError[] = [];
  const [min, max] = state.kind === 'dsa' ? [1, 4094] : [state.minVid, state.maxVid];
  const ids = new Set<number>();
  for (const v of vlans) {
    if (!Number.isInteger(v.id) || v.id < min || v.id > max) errors.push({ code: 'id-range', vlan: v.id });
    if (ids.has(v.id)) errors.push({ code: 'id-duplicate', vlan: v.id });
    ids.add(v.id);
    if (!Object.values(v.members).some((m) => m.mode !== 'off')) errors.push({ code: 'empty', vlan: v.id });
  }
  for (const p of state.ports) {
    const modes = vlans.map((v) => v.members[p.id] ?? off);
    if (modes.filter((m) => m.mode === 'untagged').length > 1) errors.push({ code: 'multiple-untagged', port: p.id });
    if (modes.filter((m) => m.mode !== 'off' && m.pvid).length > 1) errors.push({ code: 'multiple-pvid', port: p.id });
    if (p.needTag && modes.some((m) => m.mode === 'untagged')) errors.push({ code: 'needs-tag', port: p.id });
  }
  return errors;
}

/** The uci changes that turn `state.vlans` into `vlans`. VLAN IDs of saved VLANs do not change. */
export function vlanChanges(state: DsaVlans | SwitchVlans, vlans: Vlan[]): UbusCall[] {
  const changes: UbusCall[] = [];
  const kept = new Set(vlans.map((v) => v.section).filter(Boolean));
  for (const old of state.vlans) {
    if (kept.has(old.section)) continue;
    if (old.usedBy.length) throw new ActionError('vlan-in-use', old.usedBy.join(', '));
    changes.push(uci.del('network', old.section!));
  }
  if (state.kind === 'dsa') {
    for (const v of vlans) {
      const ports = dsaPorts(state, v);
      const old = state.vlans.find((o) => o.section && o.section === v.section);
      if (!old) {
        changes.push(uci.add('network', 'bridge-vlan', { device: state.bridge, vlan: String(v.id), ports }));
      } else if (dsaPorts(state, old).join(' ') !== ports.join(' ')) {
        changes.push(uci.set('network', old.section!, { ports }));
      }
    }
    return changes;
  }
  let nextIndex = Math.max(0, ...Object.values(state.indexes)) + 1;
  const cpu = state.ports.find((p) => p.cpu);
  for (const v of vlans) {
    const old = state.vlans.find((o) => o.section && o.section === v.section);
    if (old) {
      const ports = switchPortsString(state, v);
      if (switchPortsString(state, old) !== ports) changes.push(uci.set('network', old.section!, { ports }));
      continue;
    }
    // A new VLAN reaches the router through the (first) CPU port, tagged.
    const members = cpu ? { ...v.members, [cpu.id]: { mode: 'tagged' as const, pvid: false } } : v.members;
    const ports = switchPortsString(state, { ...v, members });
    if (state.vidOption) {
      if (
        state.vlan4kOption &&
        !changes.some((c) => c.method === 'set' && (c.params as { section?: string }).section === state.switchSection)
      ) {
        changes.push(uci.set('network', state.switchSection, { [state.vlan4kOption]: '1' }));
      }
      changes.push(
        uci.add('network', 'switch_vlan', {
          device: state.switchName,
          vlan: String(nextIndex++),
          [state.vidOption]: String(v.id),
          ports,
        }),
      );
    } else {
      changes.push(uci.add('network', 'switch_vlan', { device: state.switchName, vlan: String(v.id), ports }));
    }
  }
  return changes;
}

/** LuCI's "Enable VLAN filtering": VLAN 1 untagged on every port, the bridge's interfaces move to it. */
export function enableFilteringChanges(state: DsaVlans): UbusCall[] {
  if (state.filtering) throw new ActionError('filtering-on');
  return [
    uci.set('network', state.deviceSection, { vlan_filtering: '1' }),
    uci.add('network', 'bridge-vlan', {
      device: state.bridge,
      vlan: '1',
      ports: state.ports.map((p) => `${p.id}:u*`),
    }),
    ...state.bridgeUsers.map((iface) => uci.set('network', iface, { device: `${state.bridge}.1` })),
  ];
}

/** Only when filtering changes nothing: one VLAN, every port an untagged primary member. */
export function canDisableFiltering(state: DsaVlans): boolean {
  if (!state.filtering || state.vlans.length > 1) return false;
  const [only] = state.vlans;
  return !only || state.ports.every((p) => only.members[p.id]?.mode === 'untagged' && only.members[p.id]?.pvid);
}

export function disableFilteringChanges(state: DsaVlans): UbusCall[] {
  if (!canDisableFiltering(state)) throw new ActionError('filtering-in-use');
  const [only] = state.vlans;
  return [
    ...(only ? [uci.del('network', only.section!)] : []),
    uci.delOption('network', state.deviceSection, 'vlan_filtering'),
    ...(only?.usedBy ?? []).map((iface) => uci.set('network', iface, { device: state.bridge })),
  ];
}

export async function getVlans(conn: RouterConnection): Promise<VlanState> {
  const [network, board] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'network' } },
    { object: 'luci-rpc', method: 'getBoardJSON' },
  ]);
  if (!network.ok) throw network.error;
  const values = (network.data as { values?: Record<string, UciSection> }).values ?? {};
  const boardJson = board.ok ? (board.data as BoardJson) : {};
  const sw = Object.values(values).find((s) => s['.type'] === 'switch');
  let features: SwconfigFeatures = {};
  if (sw) {
    features = await conn
      .call<SwconfigFeatures>('luci', 'getSwconfigFeatures', { switch: String(sw.name ?? sw['.name']) })
      .catch(() => ({}));
  }
  return parseVlans(values, boardJson, features);
}

type Tuning = Omit<ApplyOptions, 'mode'>;

/** Always with rollback (design §11): a wrong port can cut the phone off. */
export const applyVlanChanges = (conn: RouterConnection, changes: UbusCall[], t?: Tuning): Promise<ApplyOutcome> =>
  stageAndApply(conn, changes, { mode: 'rollback', ...t });
