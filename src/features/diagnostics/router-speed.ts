import type { RouterConnection } from '@/api/connection/types';
import { routerSpeedRun, startRouterSpeedtest, type RouterSpeedResult, type SpeedRun } from '@/api/services/agent-diag';

/**
 * Router-side speed test (DG-4, plugin §12): start it, then poll its progress until the plugin reports the
 * result. A run that is already going is followed instead of starting a second one.
 */

export interface RouterSpeedOptions {
  /** LibreSpeed base URL; empty or undefined lets the plugin use its UCI setting (Cloudflare by default). */
  server?: string;
  onStart?: (run: { id: number; already: boolean }) => void;
  onProgress?: (run: SpeedRun) => void;
  signal?: AbortSignal;
  intervalMs?: number;
  /** Give up after this long; the plugin's own run takes about 25 seconds. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class RouterSpeedError extends Error {
  constructor(
    readonly code: 'failed' | 'timeout' | 'aborted',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RouterSpeedError';
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runRouterSpeedtest(
  conn: RouterConnection,
  o: RouterSpeedOptions = {},
): Promise<RouterSpeedResult> {
  const sleep = o.sleep ?? delay;
  const now = o.now ?? Date.now;
  const started = await startRouterSpeedtest(conn, o.server?.trim() || undefined);
  o.onStart?.(started);
  const deadline = now() + (o.timeoutMs ?? 90_000);
  for (;;) {
    if (o.signal?.aborted) throw new RouterSpeedError('aborted');
    await sleep(o.intervalMs ?? 1_000);
    if (o.signal?.aborted) throw new RouterSpeedError('aborted');
    const run = await routerSpeedRun(conn, started.id);
    o.onProgress?.(run);
    if (!run.running) {
      if (run.result && run.phase !== 'failed') return run.result;
      throw new RouterSpeedError('failed', run.error ?? run.result?.error);
    }
    if (now() > deadline) throw new RouterSpeedError('timeout');
  }
}
