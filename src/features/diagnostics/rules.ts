import type { SecurityLevel } from '@/features/wifi-tools/security';

/**
 * One-click diagnosis (design §18.1, DG-1): the table of checks from near to far, as pure functions. Each
 * segment gets its measured facts and answers a status and the advice to show.
 */

export type SegmentStatus = 'ok' | 'warn' | 'fail' | 'skip';

export type SegmentId =
  'phone-wifi' | 'ap-uplink' | 'wan' | 'upstream' | 'dns' | 'internet' | 'stability' | 'wifi-security';

export type Advice =
  | 'move-closer'
  | 'optimize-channel'
  | 'check-ap-cable'
  | 'check-modem'
  | 'isp-unstable'
  | 'isp-upstream'
  | 'change-dns'
  | 'outage-log'
  | 'fix-security';

export interface Verdict {
  status: SegmentStatus;
  advice: Advice[];
}

const verdict = (status: SegmentStatus, advice: Advice[] = []): Verdict => ({ status, advice });
const worst = (...s: SegmentStatus[]): SegmentStatus =>
  s.includes('fail') ? 'fail' : s.includes('warn') ? 'warn' : s.every((x) => x === 'skip') ? 'skip' : 'ok';

export interface PhoneWifiFacts {
  /** dBm as the AP hears the phone; undefined when the phone is not on this group's Wi-Fi. */
  signal?: number;
  /** Phone → router HTTP round trips (5 tries). */
  rtt: { avgMs?: number; jitterMs?: number; lossPct: number };
}

/** Phone to Wi-Fi: warn below −75 dBm or 30 ms, fail below −82 dBm, over 100 ms or any loss. */
export function phoneWifi(f: PhoneWifiFacts): Verdict {
  const weak = f.signal !== undefined && f.signal < -75;
  const status = worst(
    f.signal === undefined ? 'ok' : f.signal < -82 ? 'fail' : weak ? 'warn' : 'ok',
    f.rtt.lossPct > 0 || (f.rtt.avgMs ?? 0) > 100 ? 'fail' : (f.rtt.avgMs ?? 0) > 30 ? 'warn' : 'ok',
  );
  return verdict(status, status === 'ok' ? [] : weak ? ['move-closer', 'optimize-channel'] : ['optimize-channel']);
}

/**
 * Each AP pinging the gateway: warn over 1 % loss, fail over 10 %. `null`: the ping could not run there
 * (command refused, no LAN address to ping), which says nothing about the link and is left out.
 */
export function apUplink(aps: { lossPct: number | null }[]): Verdict {
  const known = aps.flatMap((a) => (a.lossPct === null ? [] : [a.lossPct]));
  if (!known.length) return verdict('skip');
  const status = worst(...known.map((l) => (l > 10 ? 'fail' : l > 1 ? 'warn' : 'ok')));
  return verdict(status, status === 'ok' ? [] : ['check-ap-cable']);
}

export interface WanFacts {
  up: boolean;
  hasIp: boolean;
  /** WAN reconnects in the last 24 hours (plugin events or the interface's uptime); undefined if unknown. */
  redials24h?: number;
}

/** Fail without link or address; warn after any reconnect within a day. */
export function wan(f: WanFacts): Verdict {
  if (!f.up || !f.hasIp) return verdict('fail', ['check-modem']);
  if ((f.redials24h ?? 0) >= 1) return verdict('warn', ['isp-unstable', 'outage-log']);
  return verdict('ok');
}

/**
 * Pinging the WAN's next hop: warn over 2 % loss, fail when it does not answer at all. `null`: no next hop,
 * or the ping could not run on the router (skipped, not blamed on the provider).
 */
export function upstream(f: { lossPct: number | null }): Verdict {
  if (f.lossPct === null) return verdict('skip');
  if (f.lossPct >= 100) return verdict('fail', ['isp-upstream', 'outage-log']);
  if (f.lossPct > 2) return verdict('warn', ['isp-upstream', 'outage-log']);
  return verdict('ok');
}

/** Two common names through the router's resolver: fail if one does not resolve, warn over 500 ms. */
export function dns(lookups: { ok: boolean; ms: number }[], internetReachable: boolean): Verdict {
  if (!lookups.length) return verdict('skip');
  if (lookups.some((l) => !l.ok)) return verdict('fail', internetReachable ? ['change-dns'] : []);
  if (lookups.some((l) => l.ms > 500)) return verdict('warn', ['change-dns']);
  return verdict('ok');
}

/**
 * Ping to public addresses plus the phone's HTTP 204 check: warn over 2 % loss, fail over 10 % or no 204.
 * `lossPct` is null when the pings could not run on the router; the HTTP check alone decides then.
 */
export function internet(f: { lossPct: number | null; http204?: boolean }): Verdict {
  if (f.lossPct === null && f.http204 === undefined) return verdict('skip');
  const status = worst(
    f.lossPct === null ? 'ok' : f.lossPct > 10 ? 'fail' : f.lossPct > 2 ? 'warn' : 'ok',
    f.http204 === false ? 'fail' : 'ok',
  );
  return verdict(status, status === 'ok' ? [] : ['isp-upstream', 'outage-log']);
}

/** Last 24 hours from the plugin: warn over 1 % loss or any outage, fail at 3 outages. Skipped without it. */
export function stability(f: { lossPct: number | null; outages: number } | null): Verdict {
  if (!f) return verdict('skip');
  if (f.outages >= 3) return verdict('fail', ['outage-log', 'isp-unstable']);
  if (f.outages >= 1 || (f.lossPct ?? 0) > 1) return verdict('warn', ['outage-log']);
  return verdict('ok');
}

/** WF-4's worst level among the group's networks: medium warns, low or danger fails. */
export function wifiSecurity(level: SecurityLevel | undefined): Verdict {
  if (!level) return verdict('skip');
  if (level === 'low' || level === 'danger') return verdict('fail', ['fix-security']);
  if (level === 'medium') return verdict('warn', ['fix-security']);
  return verdict('ok');
}

export const SEGMENTS: SegmentId[] = [
  'phone-wifi',
  'ap-uplink',
  'wan',
  'upstream',
  'dns',
  'internet',
  'stability',
  'wifi-security',
];

/** The headline: the nearest failing segment, else the nearest warning, else all good. */
export function overall(results: Partial<Record<SegmentId, Verdict>>): { status: SegmentStatus; segment?: SegmentId } {
  for (const status of ['fail', 'warn'] as const) {
    const segment = SEGMENTS.find((s) => results[s]?.status === status);
    if (segment) return { status, segment };
  }
  return { status: 'ok' };
}
