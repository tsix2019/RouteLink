import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';

export type LogLevel = 'emerg' | 'alert' | 'crit' | 'err' | 'warn' | 'notice' | 'info' | 'debug';

export interface LogLine {
  /** Text timestamp as printed by the router (syslog) or seconds since boot (kernel). */
  time?: string;
  level?: LogLevel;
  facility?: string;
  source?: string;
  text: string;
}

const LEVELS: LogLevel[] = ['emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug'];
const normalizeLevel = (l: string): LogLevel | undefined =>
  l === 'warning' ? 'warn' : l === 'error' ? 'err' : (LEVELS as string[]).includes(l) ? (l as LogLevel) : undefined;

/** logread lines: "Sun Oct  4 15:30:11 2026 daemon.notice netifd: Interface 'lan' is now up". */
export function parseSyslog(stdout: string): LogLine[] {
  const re = /^(\w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}) (\w+)\.(\w+) ([^:]*): ?(.*)$/;
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const m = re.exec(line);
      if (!m) return { text: line };
      return { time: m[1].replace(/ +/g, ' '), facility: m[2], level: normalizeLevel(m[3]), source: m[4] || undefined, text: m[5] };
    });
}

/** dmesg -r lines: "<6>[   12.345678] eth0: link up". */
export function parseDmesg(stdout: string): LogLine[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const m = /^<(\d+)>\[\s*([\d.]+)\]\s?(.*)$/.exec(line);
      if (!m) return { text: line };
      return { time: m[2], level: LEVELS[Number(m[1]) & 7], text: m[3] };
    });
}

interface ExecResult {
  code?: number;
  stdout?: string;
  stderr?: string;
}

async function run(conn: RouterConnection, command: string, params?: string[]): Promise<string> {
  const r = await conn.call<ExecResult>('file', 'exec', params ? { command, params } : { command }, { timeoutMs: 15_000 });
  if (r.code !== 0) throw new ActionError('log-unavailable', (r.stderr ?? '').trim() || `exit code ${r.code}`);
  return r.stdout ?? '';
}

/** LuCI's syslog wrapper (24.10 denies `log read` and plain logread to root over ubus). */
export async function systemLog(conn: RouterConnection): Promise<LogLine[]> {
  return parseSyslog(await run(conn, '/usr/libexec/syslog-wrapper'));
}

export async function kernelLog(conn: RouterConnection): Promise<LogLine[]> {
  return parseDmesg(await run(conn, '/bin/dmesg', ['-r']));
}
