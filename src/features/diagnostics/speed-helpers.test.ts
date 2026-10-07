import { DemoConnection } from '@/api/connection/demo/connection';
import { routerSpeedHistory, startRouterSpeedtest } from '@/api/services/agent-diag';
import { uci } from '@/api/uci';

import { demoSpeedFetch } from './demo';
import { RouterSpeedError, runRouterSpeedtest } from './router-speed';
import { CLOUDFLARE, runPhoneSpeedtest } from './speed';
import {
  isValidServerUrl,
  readSpeedServer,
  saveSpeedServer,
  serverHost,
  speedServerChanges,
  speedServerOf,
} from './speed-server';

describe('demo phone speed test', () => {
  afterEach(() => jest.useRealTimers());

  it('serves about 180 down, 45 up and 15 ms without touching the network', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const phases = new Set<string>();
    const run = runPhoneSpeedtest(
      { server: CLOUDFLARE, durationMs: 10_000, onProgress: (p) => phases.add(p) },
      { fetch: demoSpeedFetch(), now: Date.now },
    );
    await jest.advanceTimersByTimeAsync(30_000);
    const r = await run;
    expect(r.error).toBeUndefined();
    expect(r.latencyMs).toBeGreaterThanOrEqual(14);
    expect(r.latencyMs).toBeLessThanOrEqual(18);
    expect(r.downBps! / 1e6).toBeGreaterThan(165);
    expect(r.downBps! / 1e6).toBeLessThan(195);
    expect(r.upBps! / 1e6).toBeGreaterThan(38);
    expect(r.upBps! / 1e6).toBeLessThan(55);
    expect([...phases]).toEqual(['latency', 'download', 'upload']);
  });

  it('stops when aborted', async () => {
    jest.useFakeTimers({ now: 0 });
    const controller = new AbortController();
    const run = runPhoneSpeedtest(
      { server: CLOUDFLARE, durationMs: 10_000, signal: controller.signal },
      { fetch: demoSpeedFetch(), now: Date.now },
    );
    await jest.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await jest.advanceTimersByTimeAsync(2_000);
    const r = await run;
    expect(r.latencyMs).not.toBeNull();
    // Aborted during the download: the upload does not start.
    expect(r.upBps).toBeNull();
  });
});

describe('router speed test', () => {
  function demo() {
    let t = 1_800_000_000_000;
    const conn = new DemoConnection(2026, () => t, 0);
    const sleep = async (ms: number) => {
      t += ms;
    };
    return { conn, sleep, now: () => t };
  }

  it('polls the plugin through its phases to the result, which lands in the history', async () => {
    const { conn, sleep, now } = demo();
    const phases: string[] = [];
    const started = jest.fn();
    const r = await runRouterSpeedtest(conn, {
      sleep,
      now,
      onStart: started,
      onProgress: (run) => phases.push(run.phase),
    });
    expect(started).toHaveBeenCalledWith({ id: expect.any(Number), already: false });
    expect(new Set(phases)).toEqual(new Set(['latency', 'download', 'upload', 'done']));
    expect(r.downBps! / 1e6).toBeGreaterThan(400);
    expect((await routerSpeedHistory(conn)).results[0].id).toBe(r.id);
  });

  it('follows a run that is already going', async () => {
    const { conn, sleep, now } = demo();
    const { id } = await startRouterSpeedtest(conn);
    const started = jest.fn();
    await runRouterSpeedtest(conn, { sleep, now, onStart: started });
    expect(started).toHaveBeenCalledWith({ id, already: true });
    await expect(runRouterSpeedtest(conn, { sleep, now, timeoutMs: 0 })).rejects.toEqual(
      new RouterSpeedError('timeout'),
    );
  });

  it('stops polling when aborted', async () => {
    const { conn, sleep, now } = demo();
    const controller = new AbortController();
    controller.abort();
    await expect(runRouterSpeedtest(conn, { sleep, now, signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});

describe('speed test server setting', () => {
  it('reads and writes routelink.speedtest.server', async () => {
    const conn = new DemoConnection(2026, () => 1_800_000_000_000, 0);
    expect(await readSpeedServer(conn)).toBe('');
    const values = await uci.get(conn, 'routelink');
    const add = speedServerChanges(values, ' https://ls.example/backend/ ');
    expect(add).toEqual([uci.add('routelink', 'speedtest', { server: 'https://ls.example/backend/' }, 'speedtest')]);
    await conn.batch(add);
    expect(await readSpeedServer(conn)).toBe('https://ls.example/backend/');
    const set = speedServerChanges(await uci.get(conn, 'routelink'), '');
    expect(set).toEqual([uci.set('routelink', 'speedtest', { server: '' })]);
    expect(speedServerOf({})).toBe('');
    await saveSpeedServer(conn, 'https://other.example/');
    expect(await readSpeedServer(conn)).toBe('https://other.example/');
  });

  it('accepts http(s) URLs or nothing', () => {
    expect(isValidServerUrl('')).toBe(true);
    expect(isValidServerUrl('https://speed.example.com/backend/')).toBe(true);
    expect(isValidServerUrl('http://10.0.0.2:8080')).toBe(true);
    expect(isValidServerUrl('speed.example.com')).toBe(false);
    expect(isValidServerUrl('ftp://x')).toBe(false);
    expect(isValidServerUrl('https://')).toBe(false);
    expect(serverHost('https://speed.example.com/backend/')).toBe('speed.example.com');
  });
});
