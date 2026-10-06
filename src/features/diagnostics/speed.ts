/**
 * Phone speed test and the phone-vs-router comparison (design §18.4, DG-4). The phone measures "Wi-Fi plus
 * broadband" against the same servers the plugin uses: Cloudflare by default, or a LibreSpeed instance.
 * Network access is injected (`SpeedDeps`) so the logic runs under Jest.
 */

export interface SpeedServer {
  kind: 'cloudflare' | 'librespeed';
  /** LibreSpeed base URL (…/backend/ or the folder with garbage.php). */
  base?: string;
}

export const CLOUDFLARE: SpeedServer = { kind: 'cloudflare' };

/** "" = Cloudflare; anything else is a LibreSpeed base URL (the plugin's UCI `speedtest.server` works the same). */
export const serverOf = (setting: string): SpeedServer =>
  setting.trim() ? { kind: 'librespeed', base: setting.trim().replace(/\/?$/, '/') } : CLOUDFLARE;

export function urls(s: SpeedServer) {
  if (s.kind === 'cloudflare') {
    return {
      ping: 'https://speed.cloudflare.com/__down?bytes=0',
      download: 'https://speed.cloudflare.com/__down?bytes=100000000',
      upload: 'https://speed.cloudflare.com/__up',
    };
  }
  return {
    ping: `${s.base}empty.php`,
    download: `${s.base}garbage.php?ckSize=100`,
    upload: `${s.base}empty.php`,
  };
}

export interface LatencyStats {
  /** Median round trip, ms */
  latencyMs: number;
  /** Mean difference between consecutive round trips, ms */
  jitterMs: number;
}

export function latencyStats(samples: number[]): LatencyStats | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const latencyMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const jitterMs =
    samples.length > 1
      ? samples.slice(1).reduce((s, v, i) => s + Math.abs(v - samples[i]), 0) / (samples.length - 1)
      : 0;
  return { latencyMs, jitterMs };
}

/**
 * Bits per second from cumulative byte counts over time, leaving out the first `warmupMs` (TCP slow
 * start) like the plugin does with its first second.
 */
export function rateOf(samples: { t: number; bytes: number }[], warmupMs = 1_000): number | null {
  if (samples.length < 2) return null;
  const start = samples[0].t + warmupMs;
  const from = samples.find((s) => s.t >= start) ?? samples[0];
  const to = samples[samples.length - 1];
  const dt = (to.t - from.t) / 1000;
  return dt > 0 ? ((to.bytes - from.bytes) * 8) / dt : null;
}

export interface SpeedResult {
  ts: number;
  server: string;
  latencyMs: number | null;
  jitterMs: number | null;
  /** bits per second */
  downBps: number | null;
  upBps: number | null;
  error?: string;
}

export type SpeedPhase = 'latency' | 'download' | 'upload';

export interface SpeedDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SpeedOptions {
  server: SpeedServer;
  streams?: number;
  /** Per direction */
  durationMs?: number;
  onProgress?: (phase: SpeedPhase, progress: number, bps?: number) => void;
  signal?: AbortSignal;
}

const UPLOAD_CHUNK = 1 << 20;

/** Runs latency, then download, then upload; a failing phase leaves its value null with the reason. */
export async function runPhoneSpeedtest(o: SpeedOptions, deps: SpeedDeps): Promise<SpeedResult> {
  const u = urls(o.server);
  const streams = o.streams ?? 4;
  const duration = o.durationMs ?? 10_000;
  const result: SpeedResult = {
    ts: Math.floor(deps.now() / 1000),
    server: o.server.kind === 'cloudflare' ? 'cloudflare' : o.server.base!,
    latencyMs: null,
    jitterMs: null,
    downBps: null,
    upBps: null,
  };

  try {
    const rtts: number[] = [];
    for (let i = 0; i < 10 && !o.signal?.aborted; i++) {
      const t0 = deps.now();
      const r = await deps.fetch(`${u.ping}${u.ping.includes('?') ? '&' : '?'}r=${t0}-${i}`, {
        cache: 'no-store',
        signal: o.signal,
      });
      await r.arrayBuffer();
      rtts.push(deps.now() - t0);
      o.onProgress?.('latency', (i + 1) / 10);
    }
    const stats = latencyStats(rtts.slice(1)); // the first one pays for the connection
    result.latencyMs = stats?.latencyMs ?? null;
    result.jitterMs = stats?.jitterMs ?? null;

    result.downBps = await measure(
      deps,
      duration,
      o,
      'download',
      async (until, add, signal) => {
        while (deps.now() < until && !signal.aborted) {
          const r = await deps.fetch(u.download, { cache: 'no-store', signal });
          const reader = r.body?.getReader();
          if (!reader) {
            add((await r.arrayBuffer()).byteLength);
            continue;
          }
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            add(value.byteLength);
            if (deps.now() >= until) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
        }
      },
      streams,
    );

    const body = new Uint8Array(UPLOAD_CHUNK);
    for (let i = 0; i < body.length; i += 4096) body[i] = (i * 31) & 0xff;
    result.upBps = await measure(
      deps,
      duration,
      o,
      'upload',
      async (until, add, signal) => {
        while (deps.now() < until && !signal.aborted) {
          const r = await deps.fetch(u.upload, {
            method: 'POST',
            body,
            signal,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          await r.arrayBuffer();
          add(body.byteLength);
        }
      },
      streams,
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/** Runs `streams` workers until the deadline, sampling the shared byte count every 250 ms. */
async function measure(
  deps: SpeedDeps,
  duration: number,
  o: SpeedOptions,
  phase: SpeedPhase,
  worker: (until: number, add: (n: number) => void, signal: AbortSignal) => Promise<void>,
  streams: number,
): Promise<number | null> {
  const controller = new AbortController();
  o.signal?.addEventListener('abort', () => controller.abort());
  const start = deps.now();
  const until = start + duration;
  let bytes = 0;
  const samples = [{ t: start, bytes: 0 }];
  const add = (n: number) => {
    bytes += n;
    const t = deps.now();
    if (t - samples[samples.length - 1].t >= 250) {
      samples.push({ t, bytes });
      o.onProgress?.(phase, Math.min(1, (t - start) / duration), rateOf(samples) ?? undefined);
    }
  };
  const runs = Array.from({ length: streams }, () => worker(until, add, controller.signal).catch(() => undefined));
  await Promise.all(runs);
  samples.push({ t: deps.now(), bytes });
  return rateOf(samples);
}

export type Comparison = 'wifi-bottleneck' | 'broadband' | 'ok';

/**
 * Phone below 60 % of the router: the Wi-Fi is the bottleneck. Both below 60 % of the contracted speed
 * (only when the user entered one): the broadband is the problem.
 */
export function compareSpeeds(phoneBps: number, routerBps: number, contractBps?: number): Comparison {
  if (routerBps > 0 && phoneBps < routerBps * 0.6) return 'wifi-bottleneck';
  if (contractBps && phoneBps < contractBps * 0.6 && routerBps < contractBps * 0.6) return 'broadband';
  return 'ok';
}
