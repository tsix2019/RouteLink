import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';

export interface Process {
  pid: number;
  ppid: number;
  user: string;
  /** busybox top state: R running, S sleeping, D waiting, Z zombie (W/N/< flags stripped). */
  state: string;
  memoryKb: number;
  memPercent: number;
  cpuPercent: number;
  command: string;
  /** Program name without path and arguments. */
  name: string;
  /** Kernel threads ("[kworker/0:1]") have no program to stop. */
  kernel: boolean;
}

export type Signal = 'HUP' | 'TERM' | 'KILL';
const SIGNAL_NUMBERS: Record<Signal, number> = { HUP: 1, TERM: 15, KILL: 9 };

/** busybox prints sizes in KB, or with a unit once they get large ("12m"). */
function sizeKb(v: unknown): number {
  const m = /^(\d+(?:\.\d+)?)([kmg]?)$/i.exec(String(v ?? '').trim());
  if (!m) return 0;
  const unit = { '': 1, k: 1, m: 1024, g: 1024 * 1024 }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g'];
  return Math.round(Number(m[1]) * unit);
}

const percent = (v: unknown) => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export function parseProcesses(raw: unknown): Process[] {
  const list = (raw as { result?: unknown })?.result;
  if (!Array.isArray(list)) return [];
  const out: Process[] = [];
  for (const item of list) {
    const p = item as Record<string, unknown> | null;
    const pid = Number(p?.PID);
    if (!p || !Number.isInteger(pid) || pid <= 0) continue;
    const command = String(p.COMMAND ?? '');
    const kernel = command.startsWith('[');
    const first = kernel ? command.replace(/^\[|\]$/g, '') : command.split(/\s+/)[0];
    out.push({
      pid,
      ppid: Number(p.PPID) || 0,
      user: String(p.USER ?? ''),
      state: String(p.STAT ?? '')
        .trim()
        .charAt(0),
      memoryKb: sizeKb(p.VSZ),
      memPercent: percent(p['%MEM']),
      cpuPercent: percent(p['%CPU']),
      command,
      name: kernel ? first : first.split('/').pop() || first,
      kernel,
    });
  }
  return out.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryKb - a.memoryKb || a.pid - b.pid);
}

export async function listProcesses(conn: RouterConnection): Promise<Process[]> {
  return parseProcesses(await conn.call('luci', 'getProcessList'));
}

/** PID 1 (procd) and kernel threads are off limits. */
export const canSignal = (p: Process) => !p.kernel && p.pid !== 1;

/** Like LuCI's process page: `kill -<number> <pid>`. */
export async function signalProcess(conn: RouterConnection, pid: number, signal: Signal): Promise<void> {
  const r = await conn.call<{ code?: number; stderr?: string }>('file', 'exec', {
    command: '/bin/kill',
    params: [`-${SIGNAL_NUMBERS[signal]}`, String(pid)],
  });
  if (r.code !== 0) throw new ActionError('kill-failed', r.stderr?.trim() || `kill exited with ${r.code}`);
}
