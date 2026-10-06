import type { Band } from '@/api/services/clients';

/** Signal quality of a wireless client as its access point hears it (design §17.1, WF-1). */

export type SignalGrade = 'excellent' | 'good' | 'fair' | 'poor';

const GRADES: SignalGrade[] = ['excellent', 'good', 'fair', 'poor'];

/** ≥ −60 dBm excellent, down to −70 good, down to −80 fair, below that poor; SNR under 20 dB costs a grade. */
export function gradeSignal(signal: number, noise?: number): SignalGrade {
  let i = signal >= -60 ? 0 : signal >= -70 ? 1 : signal >= -80 ? 2 : 3;
  if (noise !== undefined && noise < 0 && signal - noise < 20) i = Math.min(3, i + 1);
  return GRADES[i];
}

export const snrOf = (signal: number, noise?: number): number | undefined =>
  noise !== undefined && noise < 0 ? signal - noise : undefined;

/** 0–4 bars for list rows. */
export function signalBars(signal: number): number {
  if (signal >= -55) return 4;
  if (signal >= -65) return 3;
  if (signal >= -75) return 2;
  if (signal >= -85) return 1;
  return 0;
}

/**
 * What a two-stream client usually negotiates (kbit/s) at a channel width: 802.11n on 2.4 GHz, 802.11ac
 * on 5 GHz and 802.11ax on 6 GHz, close to the AP. Half of it is where a link stops being "normal".
 */
export function typicalRate(band: Band, widthMhz?: number): number {
  if (band === '2.4G') return widthMhz && widthMhz >= 40 ? 300_000 : 144_400;
  const w = widthMhz ?? 80;
  if (band === '6G') return w >= 160 ? 2_401_900 : w >= 80 ? 1_201_000 : w >= 40 ? 573_500 : 286_800;
  return w >= 160 ? 1_733_300 : w >= 80 ? 866_700 : w >= 40 ? 400_000 : 173_300;
}

/** The negotiated rate (the slower direction) is under half the usual one for the band and width. */
export function isRateLow(band: Band, rates: { rx?: number; tx?: number }, widthMhz?: number): boolean {
  const known = [rates.rx, rates.tx].filter((r): r is number => typeof r === 'number' && r > 0);
  if (!known.length) return false;
  return Math.min(...known) < typicalRate(band, widthMhz) / 2;
}

export type SignalTip = 'move-closer' | 'add-ap' | 'rate-low';

/** Advice for one client (design §17.1 "提示"). */
export function signalTips(grade: SignalGrade, rateLow: boolean): SignalTip[] {
  const tips: SignalTip[] = [];
  if (grade === 'fair' || grade === 'poor') tips.push('move-closer', 'add-ap');
  if (rateLow) tips.push('rate-low');
  return tips;
}

/** Retransmitted share of the sent frames, in percent. */
export function retryRate(retries?: number, packets?: number): number | undefined {
  if (retries === undefined || !packets) return undefined;
  return Math.min(100, (retries / (packets + retries)) * 100);
}

/** Weakest first, unknown signals last. */
export const byWeakest = <T extends { signal?: number }>(a: T, b: T) => (a.signal ?? 1) - (b.signal ?? 1);
