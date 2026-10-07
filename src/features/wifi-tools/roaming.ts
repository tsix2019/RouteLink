import type { AgentEvent } from '@/api/services/agent';
import { bandOfFreq, type Band } from '@/api/services/clients';
import { normalizeMac } from '@/utils/mac';

/**
 * A client's roaming record (design §17.1, plan P2 §0.6): the `wifi_connect` and `wifi_disconnect` events
 * of every router of the group that samples Wi-Fi, merged. Each event's value is the interface's frequency.
 */

export interface RoamSource {
  routerId: string;
  name: string;
  events: readonly AgentEvent[];
}

export interface RoamEntry {
  /** Epoch seconds. */
  ts: number;
  kind: 'connect' | 'disconnect';
  routerId: string;
  apName: string;
  band?: Band;
  /** A connect right after leaving another AP or band (or while still listed there). */
  roamed: boolean;
}

/** Leaving one AP and joining the next within this many seconds counts as roaming. */
export const ROAM_WINDOW_SEC = 60;

const KINDS: Record<string, RoamEntry['kind']> = { wifi_connect: 'connect', wifi_disconnect: 'disconnect' };

const where = (e: Pick<RoamEntry, 'routerId' | 'band'>) => `${e.routerId}/${e.band ?? ''}`;

/** Newest first; at the same second the connect is listed above the disconnect it follows. */
export function roamingRecord(sources: readonly RoamSource[], mac: string, windowSec = ROAM_WINDOW_SEC): RoamEntry[] {
  const target = normalizeMac(mac);
  const entries: RoamEntry[] = [];
  for (const s of sources) {
    for (const e of s.events) {
      const kind = KINDS[e.type];
      if (!kind || !e.mac || normalizeMac(e.mac) !== target) continue;
      entries.push({
        ts: e.ts,
        kind,
        routerId: s.routerId,
        apName: s.name,
        band: e.value ? bandOfFreq(e.value) : undefined,
        roamed: false,
      });
    }
  }
  // Oldest first, disconnects before connects of the same second.
  entries.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === 'disconnect' ? -1 : 1));

  let previous: RoamEntry | undefined;
  for (const e of entries) {
    if (e.kind === 'connect' && previous && where(previous) !== where(e)) {
      // The other AP may report the disconnect late (or not at all): a connect still counts when the
      // previous event elsewhere was a connect.
      e.roamed = previous.kind === 'connect' || e.ts - previous.ts <= windowSec;
    }
    previous = e;
  }
  return entries.reverse();
}
