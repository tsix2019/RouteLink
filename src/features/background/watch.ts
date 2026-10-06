/** What the background check remembers about one router between runs (design §19). */
export interface WatchMemory {
  /** Undefined until the first check. */
  reachable?: boolean;
  /** Every MAC address seen so far, upper case. */
  knownMacs: string[];
  checkedAt: number;
}

export interface WatchReading {
  reachable: boolean;
  /** Devices the router knows now; absent when it could not be read (unreachable, or no permission). */
  devices?: { mac: string; name: string }[];
  /** How many of them are online. */
  online?: number;
}

export type Alert = { kind: 'offline' } | { kind: 'online' } | { kind: 'new-device'; mac: string; name: string };

/** Enough for a home network; the oldest drop out first. */
const MAX_KNOWN = 1000;

/**
 * Alerts for one reading: down after being up, up after being down, and devices never seen before. The first
 * reading only learns (no alert for every device already there).
 */
export function compare(
  previous: WatchMemory | undefined,
  now: WatchReading,
  at: number,
): {
  alerts: Alert[];
  next: WatchMemory;
} {
  const alerts: Alert[] = [];
  if (previous?.reachable === true && !now.reachable) alerts.push({ kind: 'offline' });
  if (previous?.reachable === false && now.reachable) alerts.push({ kind: 'online' });

  const known = new Set(previous?.knownMacs ?? []);
  const fresh = (now.devices ?? []).filter((d) => !known.has(d.mac.toUpperCase()));
  if (previous && previous.knownMacs.length) {
    for (const d of fresh) alerts.push({ kind: 'new-device', mac: d.mac.toUpperCase(), name: d.name });
  }
  const knownMacs = [...(previous?.knownMacs ?? []), ...fresh.map((d) => d.mac.toUpperCase())].slice(-MAX_KNOWN);
  return { alerts, next: { reachable: now.reachable, knownMacs, checkedAt: at } };
}
