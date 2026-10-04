import { isConnectivityError } from '../http/errors';
import type { RouterConnection } from '../connection/types';
import type { UbusResult } from '../ubus/types';

export interface SystemSnapshot {
  hostname: string;
  /** Board model ("OpenWrt One"); falls back to the CPU name on x86. */
  model: string;
  boardName?: string;
  distribution: string;
  version: string;
  /** e.g. "OpenWrt 24.10.8 r29233-443ec4032a" */
  firmware: string;
  kernel: string;
  target: string;
  uptimeSec: number;
  /** Router clock, epoch seconds. */
  localTime: number;
  /** Already divided by 65536. */
  load: [number, number, number];
  cpuCores: number | null;
  /** Bytes. */
  memory: { total: number; available: number; used: number; buffered: number; cached: number };
  /** Bytes (ubus reports KiB). */
  storage: { root?: { total: number; used: number }; tmp?: { total: number; used: number } };
}

interface Board {
  hostname?: string;
  model?: string;
  board_name?: string;
  system?: string;
  kernel?: string;
  release?: { distribution?: string; version?: string; description?: string; target?: string };
}

interface Info {
  localtime?: number;
  uptime?: number;
  load?: number[];
  memory?: { total?: number; free?: number; available?: number; buffered?: number; cached?: number };
  root?: { total?: number; used?: number };
  tmp?: { total?: number; used?: number };
}

const value = <T>(r: UbusResult): T | undefined => (r.ok ? (r.data as T) : undefined);

function storage(s?: { total?: number; used?: number }) {
  return s?.total ? { total: s.total * 1024, used: (s.used ?? 0) * 1024 } : undefined;
}

export function parseSystem(board: Board, info: Info, cpuEntries?: { name: string; type: string }[]): SystemSnapshot {
  const release = board.release ?? {};
  const mem = info.memory ?? {};
  const total = mem.total ?? 0;
  const available = mem.available ?? mem.free ?? 0;
  const load = (info.load ?? [0, 0, 0]).slice(0, 3).map((l) => l / 65536) as [number, number, number];
  const cores = cpuEntries?.filter((e) => e.type === 'directory' && /^cpu\d+$/.test(e.name)).length;
  return {
    hostname: board.hostname ?? '',
    model: board.model ?? board.system ?? release.distribution ?? 'OpenWrt',
    boardName: board.board_name,
    distribution: release.distribution ?? 'OpenWrt',
    version: release.version ?? '',
    firmware: release.description ?? `${release.distribution ?? ''} ${release.version ?? ''}`.trim(),
    kernel: board.kernel ?? '',
    target: release.target ?? '',
    uptimeSec: info.uptime ?? 0,
    localTime: info.localtime ?? 0,
    load,
    cpuCores: cores ? cores : null,
    memory: {
      total,
      available,
      used: Math.max(0, total - available),
      buffered: mem.buffered ?? 0,
      cached: mem.cached ?? 0,
    },
    storage: { root: storage(info.root), tmp: storage(info.tmp) },
  };
}

/** board + info + CPU count in one request. */
export async function getSystem(conn: RouterConnection): Promise<SystemSnapshot> {
  const [board, info, cpus] = await conn.batch([
    { object: 'system', method: 'board' },
    { object: 'system', method: 'info' },
    { object: 'file', method: 'list', params: { path: '/sys/devices/system/cpu' } },
  ]);
  if (!board.ok) throw board.error;
  if (!info.ok) throw info.error;
  return parseSystem(
    board.data as Board,
    info.data as Info,
    value<{ entries?: { name: string; type: string }[] }>(cpus)?.entries,
  );
}

/** 1-minute load relative to the core count, 0..1 (null when the core count is unknown). */
export const loadRatio = (s: SystemSnapshot): number | null =>
  s.cpuCores ? Math.min(1, s.load[0] / s.cpuCores) : null;

/** Only ImmortalWrt ships `luci getTempInfo`; returns °C or null. */
export async function getTemperature(conn: RouterConnection): Promise<number | null> {
  try {
    const data = await conn.call<unknown>('luci', 'getTempInfo');
    const numbers: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'number' && Number.isFinite(v)) numbers.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(data);
    if (numbers.length === 0) return null;
    const max = Math.max(...numbers);
    return max > 1000 ? max / 1000 : max; // millidegrees from sysfs
  } catch {
    return null;
  }
}

/** The router drops the connection while rebooting; that is success, not an error. */
export async function reboot(conn: RouterConnection): Promise<void> {
  try {
    await conn.call('file', 'exec', { command: '/sbin/reboot' }, { timeoutMs: 5_000 });
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
  }
}
