import type { LiveMonitorSample, LiveMonitorTexts } from 'routelink-native';

import { formatBitRate } from '@/utils/format';

// The live monitor's notification text (design §16, LU-1/LU-2). The Android service formats its own
// notifications in the background with the same rules (LiveFormat.kt): keep the two in step.

/** Durations offered when starting, in minutes; null runs until stopped. */
export const LIVE_DURATIONS = [30, 60, 240, null] as const;
export type LiveDuration = (typeof LIVE_DURATIONS)[number];

/** 1 KB/s: below that the "busiest device" line is noise. */
export const MIN_TOP_BPS = 8_000;

const CHIP_UNITS = ['K', 'M', 'G', 'T'] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The status-bar chip (setShortCriticalText): "↓12.3M", never more than 7 characters. */
export function chipText(bitsPerSec: number): string {
  const v = Number.isFinite(bitsPerSec) && bitsPerSec > 0 ? bitsPerSec : 0;
  if (v < 50) return '↓0K';
  let n = v / 1000;
  let i = 0;
  while (i < CHIP_UNITS.length - 1 && round1(n) >= 999.95) {
    n /= 1000;
    i++;
  }
  const text = Math.round(n * 10) < 1000 ? n.toFixed(1) : String(Math.round(n));
  return `↓${text}${CHIP_UNITS[i]}`;
}

/** Replaces {key} placeholders (the native templates use single braces, unlike i18next). */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [key, value]) => s.split(`{${key}}`).join(String(value)), template);
}

/** First line: "↓ 12.3 Mbps ↑ 1.2 Mbps · 18 online". */
export function lineText(texts: LiveMonitorTexts, sample: LiveMonitorSample): string {
  const rates = { rx: formatBitRate(sample.rxBps), tx: formatBitRate(sample.txBps) };
  return sample.online === undefined
    ? fill(texts.lineNoCount, rates)
    : fill(texts.line, { ...rates, online: sample.online });
}

/** Second line, the busiest device: "Busiest: Ming's iPad ↓ 8.1 Mbps", or null when nothing moves. */
export function topText(
  texts: LiveMonitorTexts,
  sample: LiveMonitorSample,
  names: Record<string, string>,
): string | null {
  const device = [...(sample.devices ?? [])].sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))[0];
  if (!device || Math.max(device.rxBps, device.txBps) < MIN_TOP_BPS) return null;
  const name = names[device.mac.toUpperCase()] ?? names[device.mac] ?? device.mac;
  const rate = device.rxBps >= device.txBps ? `↓ ${formatBitRate(device.rxBps)}` : `↑ ${formatBitRate(device.txBps)}`;
  return fill(texts.top, { name, rate });
}

/** How long the router was offline, for "Back online (offline for 3m 20s)". */
export function offlineDuration(ms: number, texts: Pick<LiveMonitorTexts, 'sec' | 'minSec' | 'hourMin'>): string {
  const total = Math.floor((Math.max(0, ms) + 500) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (total < 60) return fill(texts.sec, { s });
  if (total < 3600) return fill(texts.minSec, { m, s });
  return fill(texts.hourMin, { h, m });
}

/** Wall-clock end of a monitor started now, or null for "until stopped". */
export function endsAtFor(durationMin: LiveDuration, now: number): number | null {
  return durationMin === null ? null : now + durationMin * 60_000;
}

/** Milliseconds left, never negative; null when it runs until stopped. */
export function remainingMs(endsAt: number | null | undefined, now: number): number | null {
  return endsAt == null ? null : Math.max(0, endsAt - now);
}

/** Countdown on the overview button: "29:59", "3:59:59". Rounds up, so it reads 0:00 only at the end. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
