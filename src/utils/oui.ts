import { isRandomizedMac } from './mac';

/** See scripts/gen-oui.ts: `p` holds sorted 9-char records "PREFIX(6 hex) + vendor index(3 base36)". */
interface OuiDb {
  v: string[];
  p: string;
}

const RECORD = 9;
let db: OuiDb | null = null;

export function lookupVendor(mac: string): string | null {
  const key = mac.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase();
  if (key.length !== 6 || isRandomizedMac(key)) return null;
  db ??= require('@/data/oui.json') as OuiDb;

  let lo = 0;
  let hi = db.p.length / RECORD - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = mid * RECORD;
    const prefix = db.p.slice(at, at + 6);
    if (prefix === key) return db.v[parseInt(db.p.slice(at + 6, at + RECORD), 36)] ?? null;
    if (prefix < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}
