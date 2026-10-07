import type { Timezone } from '@/api/services/system-settings';

// LuCI names zones with spaces ("America/New York"), people often type the IANA underscore.
const fold = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** The zones whose name or TZ string contains the query (case-insensitive); all of them for a blank one. */
export function filterZones(zones: Timezone[], query: string): Timezone[] {
  const q = fold(query.trim());
  if (!q) return zones;
  return zones.filter((z) => fold(z.zonename).includes(q) || fold(z.tz).includes(q));
}
