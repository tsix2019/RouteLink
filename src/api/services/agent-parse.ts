import { normalizeMac } from '@/utils/mac';

/** Lenient readers for plugin replies: never throw on odd input, fall back to safe defaults. */

export type Raw = Record<string, unknown>;
export const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const bool = (v: unknown): boolean => v === true || v === 1;
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string');
export const mac = (v: unknown): string => normalizeMac(str(v)) ?? str(v).toUpperCase();
export const optional = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
/** The plugin reports bytes per second; the app shows bits per second like the rest of the UI. */
export const bps = (bytesPerSec: unknown): number => Math.max(0, num(bytesPerSec)) * 8;
export const nullable = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A number when present, otherwise undefined (fields the plugin leaves out when unknown). */
export const maybe = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
