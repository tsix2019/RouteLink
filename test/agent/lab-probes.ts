/**
 * Latency probes of the lab server, for the suites that need the daemon to see the internet. CI runners drop
 * ICMP to the default probe targets, so whenever a suite restores those the daemon logs an outage of its own
 * after three rounds: it holds push messages back and is one more outage for a test that counts them.
 */
type Call = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

interface Latency {
  targets: { id: number; ip: string; kind: 'gateway' | 'custom' }[];
  summary: { target: number; sent: number; lost: number }[];
}
interface Outages {
  outages: { ongoing: boolean }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

/** Answered probes of `ip` from `from` on: with a fixed start the count only grows. */
export async function answeredProbes(call: Call, ip: string, from: number): Promise<number> {
  const l = await call<Latency>('latency', { start: from, end: now() + 60 });
  const target = l.targets.find((t) => t.ip === ip && t.kind === 'custom');
  const s = l.summary.find((x) => x.target === target?.id);
  return s ? s.sent - s.lost : 0;
}

/**
 * Waits after `ip` became the probe target until at least `count` probes of it were answered from `from` on
 * (count it before the switch, add the rounds wanted since) and no outage is ongoing. reload_config returns
 * before the daemon has read the configuration again, and answers an earlier suite got are still in the
 * latency history: only new answers show that the daemon probes `ip` now, and the first one ends an outage
 * the old targets began.
 */
export async function waitForProbes(call: Call, ip: string, from: number, count: number, seconds = 90) {
  let got = 0;
  for (let i = 0; i < seconds; i++) {
    got = await answeredProbes(call, ip, from);
    if (got >= count) {
      const t = now();
      const o = await call<Outages>('outages', { start: t - 60, end: t + 60 });
      if (!o.outages.some((x) => x.ongoing)) return;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${count} answered probes of ${ip} and no ongoing outage (${got} answered)`);
}
