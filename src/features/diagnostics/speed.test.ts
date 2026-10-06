import { compareSpeeds, latencyStats, rateOf, runPhoneSpeedtest, serverOf, urls } from './speed';

describe('helpers', () => {
  it('picks the server URLs', () => {
    expect(urls(serverOf('')).download).toContain('speed.cloudflare.com/__down');
    expect(urls(serverOf('https://ls.example/backend')).download).toBe(
      'https://ls.example/backend/garbage.php?ckSize=100',
    );
  });

  it('takes the median and the mean step for latency and jitter', () => {
    expect(latencyStats([10, 30, 20, 40])).toEqual({ latencyMs: 25, jitterMs: (20 + 10 + 20) / 3 });
    expect(latencyStats([])).toBeNull();
  });

  it('computes a rate leaving out the warm-up', () => {
    const samples = [
      { t: 0, bytes: 0 },
      { t: 500, bytes: 10 },
      { t: 1_000, bytes: 1_000 },
      { t: 3_000, bytes: 251_000 },
    ];
    expect(rateOf(samples)).toBe((250_000 * 8) / 2);
    expect(rateOf([{ t: 0, bytes: 0 }])).toBeNull();
  });

  it('compares phone and router', () => {
    expect(compareSpeeds(100e6, 300e6)).toBe('wifi-bottleneck');
    expect(compareSpeeds(250e6, 300e6)).toBe('ok');
    expect(compareSpeeds(250e6, 300e6, 1000e6)).toBe('broadband');
    expect(compareSpeeds(250e6, 300e6, 400e6)).toBe('ok');
  });
});

it('runs latency, download and upload against a fake network and clock', async () => {
  let now = 0;
  const calls: string[] = [];
  const chunk = new Uint8Array(125_000); // 1 Mbit
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    now += 5; // every request takes 5 ms
    const download = url.includes('bytes=100000000');
    let sent = 0;
    return {
      arrayBuffer: async () => new ArrayBuffer(0),
      body: download
        ? {
            getReader: () => ({
              read: async () => {
                now += 10; // 1 Mbit per 10 ms per stream = 100 Mbit/s
                sent++;
                return sent > 400 ? { done: true, value: undefined } : { done: false, value: chunk };
              },
              cancel: async () => undefined,
            }),
          }
        : null,
    } as unknown as Response;
  }) as typeof fetch;

  const phases = new Set<string>();
  const r = await runPhoneSpeedtest(
    { server: serverOf(''), streams: 1, durationMs: 2_000, onProgress: (p) => phases.add(p) },
    { fetch: fakeFetch, now: () => now },
  );
  expect(r.error).toBeUndefined();
  expect(r.latencyMs).toBe(5);
  expect(r.downBps! / 1e6).toBeGreaterThan(90);
  expect(r.downBps! / 1e6).toBeLessThan(110);
  expect(r.upBps).toBeGreaterThan(0);
  expect([...phases]).toEqual(['latency', 'download', 'upload']);
  expect(calls.filter((c) => c.startsWith('POST'))[0]).toBe('POST https://speed.cloudflare.com/__up');
});
