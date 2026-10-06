import type { Band, Client } from '@/api/services/clients';

import { byWeakest, gradeSignal, signalBars, snrOf, type SignalGrade } from './signal';

/** The signal monitor's list (design §17.1, WF-1): every wireless client of the network group. */

export interface SignalRow {
  mac: string;
  name: string;
  client: Client;
  /** dBm, as the access point hears the client. */
  signal: number;
  noise?: number;
  snr?: number;
  grade: SignalGrade;
  bars: number;
  /** kbit/s */
  rxRate?: number;
  txRate?: number;
  band: Band;
  ssid: string;
  /** The group router the client is associated with; unset when the active router has no group. */
  apId?: string;
  apName?: string;
  connectedSec?: number;
  /** The phone running the app. */
  isPhone: boolean;
}

export type SignalSort = 'weakest' | 'name';

/** The phone's own entry: the client holding the phone's IPv4 address. */
export function findPhone(clients: readonly Client[], phoneIp: string | null | undefined): Client | undefined {
  if (!phoneIp) return undefined;
  return clients.find((c) => c.ipv4 === phoneIp);
}

/** Online clients with fresh Wi-Fi details (clients of an AP that does not answer have none). */
export function signalRows(clients: readonly Client[], phoneIp?: string | null): SignalRow[] {
  const phone = findPhone(clients, phoneIp);
  return clients
    .filter((c): c is Client & { wifi: NonNullable<Client['wifi']> } => c.online && !!c.wifi)
    .map((c) => ({
      mac: c.mac,
      name: c.name,
      client: c,
      signal: c.wifi.signal,
      noise: c.wifi.noise,
      snr: snrOf(c.wifi.signal, c.wifi.noise),
      grade: gradeSignal(c.wifi.signal, c.wifi.noise),
      bars: signalBars(c.wifi.signal),
      rxRate: c.wifi.rxRate,
      txRate: c.wifi.txRate,
      band: c.wifi.band,
      ssid: c.wifi.ssid,
      apId: c.ap?.routerId,
      apName: c.ap?.name,
      connectedSec: c.wifi.connectedSec,
      isPhone: c.mac === phone?.mac,
    }));
}

const byName = (a: SignalRow, b: SignalRow) => a.name.localeCompare(b.name) || a.mac.localeCompare(b.mac);

export function sortSignalRows(rows: readonly SignalRow[], sort: SignalSort): SignalRow[] {
  return [...rows].sort(sort === 'weakest' ? (a, b) => byWeakest(a, b) || byName(a, b) : byName);
}

export function gradeCounts(rows: readonly SignalRow[]): Record<SignalGrade, number> {
  const counts: Record<SignalGrade, number> = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const r of rows) counts[r.grade]++;
  return counts;
}

/** Route of a client's signal detail; `router` names the AP it is on. */
export function signalHref(mac: string, apId?: string): string {
  const base = `/wireless/tools/signal/${encodeURIComponent(mac)}`;
  return apId ? `${base}?router=${encodeURIComponent(apId)}` : base;
}
