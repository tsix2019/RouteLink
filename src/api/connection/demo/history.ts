import type { RatePoint } from '../../services/traffic';
import { createRandom } from './random';

/**
 * A minute of believable WAN traffic for the demo router, so its chart isn't empty on first look:
 * the same bounded random walk as the live demo (~40 Mbps down, ~6 Mbps up, occasional spikes).
 */
export function demoRateHistory(count: number, intervalMs: number, end: number, seed = 7): RatePoint[] {
  const rng = createRandom(seed);
  const walk = (value: number, mean: number, spread: number) => {
    const spike = rng.next() < 0.05 ? mean * (1 + rng.next() * 2) : 0;
    const next = value + (mean - value) * 0.3 + (rng.next() - 0.5) * spread + spike;
    return Math.max(mean * 0.05, Math.min(mean * 4, next));
  };
  let rx = 5_000_000;
  let tx = 750_000;
  return Array.from({ length: count }, (_, i) => {
    rx = walk(rx, 5_000_000, 2_500_000);
    tx = walk(tx, 750_000, 400_000);
    return { t: end - (count - 1 - i) * intervalMs, rxBps: rx * 8, txBps: tx * 8 };
  });
}
