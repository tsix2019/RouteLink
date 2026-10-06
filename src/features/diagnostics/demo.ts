/**
 * Demo mode must not touch the real internet: a stand-in network for the phone speed test that serves
 * about 180 Mbit/s down, 45 Mbit/s up and 15 ms over four streams, in real (or Jest's fake) time.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const STREAMS = 4;
/** One download read every TICK ms. */
const TICK = 50;

function aborted(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export interface DemoSpeedOptions {
  downBps?: number;
  upBps?: number;
  wait?: (ms: number) => Promise<void>;
}

export function demoSpeedFetch(o: DemoSpeedOptions = {}): typeof fetch {
  const wait = o.wait ?? sleep;
  const downPerStream = (o.downBps ?? 180e6) / STREAMS / 8; // bytes per second
  const upPerStream = (o.upBps ?? 45e6) / STREAMS / 8;
  const chunk = new Uint8Array(Math.round((downPerStream * TICK) / 1000));
  let pings = 0;
  let uploads = 0;

  const respond = (body: ReadableStream<Uint8Array> | null = null) =>
    ({ ok: true, status: 200, body, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw aborted();

    if (init?.method === 'POST') {
      const size = (init.body as Uint8Array | undefined)?.byteLength ?? 0;
      // The streams' first requests start a little apart, as real connections do.
      const stagger = uploads < STREAMS ? uploads * 190 : 0;
      uploads++;
      await wait(stagger + (size / upPerStream) * 1000);
      if (signal?.aborted) throw aborted();
      return respond();
    }

    if (url.includes('bytes=0') || url.includes('empty.php')) {
      await wait(14 + (pings++ % 4));
      return respond();
    }

    let done = false;
    const reader = {
      read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        if (done || signal?.aborted) return { done: true, value: undefined };
        await wait(TICK);
        return { done: false, value: chunk };
      },
      cancel: async () => {
        done = true;
      },
      releaseLock: () => undefined,
    };
    return respond({ getReader: () => reader } as unknown as ReadableStream<Uint8Array>);
  }) as typeof fetch;
}
