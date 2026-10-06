import {
  isValidTarget,
  parseNslookup,
  parsePing,
  parseTraceroute,
  toolCommand,
  type Hop,
  type NslookupResult,
  type PingSummary,
  type Tool,
  type ToolOptions,
} from '@/features/diagnostics/tools';

import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';

/** DG-2: runs a diagnostic tool on a router through `file exec` (LuCI's diagnostics ACL, no plugin). */

export type ToolResult = { tool: Tool; code: number; output: string; ms: number } & (
  | { tool: 'ping'; summary: PingSummary }
  | { tool: 'traceroute'; summary: Hop[] }
  | { tool: 'nslookup'; summary: NslookupResult }
);

/** Long enough for 20 pings or 20 traceroute hops (design §18.2). */
export const TOOL_TIMEOUT_MS = 60_000;

export async function runTool(
  conn: RouterConnection,
  tool: Tool,
  target: string,
  o: ToolOptions = {},
  now: () => number = Date.now,
): Promise<ToolResult> {
  if (!isValidTarget(target) || (o.server && !isValidTarget(o.server))) throw new ActionError('target-invalid');
  const { command, params } = toolCommand(tool, target, o);
  const started = now();
  const r = await conn.call<{ code?: number; stdout?: string; stderr?: string }>(
    'file',
    'exec',
    { command, params },
    { timeoutMs: TOOL_TIMEOUT_MS },
  );
  const ms = now() - started;
  // busybox prints traceroute's header and most errors on stderr.
  const output = [r.stderr ?? '', r.stdout ?? ''].filter(Boolean).join('\n');
  const code = r.code ?? 0;
  switch (tool) {
    case 'ping':
      return { tool, code, output, ms, summary: parsePing(output) };
    case 'traceroute':
      return { tool, code, output, ms, summary: parseTraceroute(output) };
    case 'nslookup':
      return { tool, code, output, ms, summary: parseNslookup(output) };
  }
}
