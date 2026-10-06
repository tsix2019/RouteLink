import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import { list, mac, maybe, nullable, num, obj, optional, str } from './agent-parse';

/** Wireless sampling of the plugin on an access point (P2, plan §1.2–§1.4). */

export type WifiMode = 'legacy' | 'ht' | 'vht' | 'he';

export interface AgentWifiIface {
  ifname: string;
  phy: string;
  ssid: string;
  bssid?: string;
  /** MHz */
  freq: number;
  channel: number;
  /** MHz */
  width?: number;
  noise?: number;
  stations: number;
}

export interface AgentStation {
  mac: string;
  ifname: string;
  freq: number;
  signal: number;
  signalAvg?: number;
  noise?: number;
  inactiveMs: number;
  connectedSec?: number;
  /** kbit/s */
  rxRate?: number;
  txRate?: number;
  rxMcs?: number;
  txMcs?: number;
  rxNss?: number;
  txNss?: number;
  width?: number;
  mode?: WifiMode;
  rxBytes?: number;
  txBytes?: number;
  txRetries?: number;
  txFailed?: number;
  txPackets?: number;
}

export interface AgentStations {
  ts: number;
  liveUntil: number;
  interfaces: AgentWifiIface[];
  stations: AgentStation[];
}

export type SignalTier = 'live' | 'minute' | 'hour';

export interface SignalPoint {
  t: number;
  /** dBm; null where there is no data */
  signal: number | null;
  minSignal: number | null;
  /** kbit/s */
  txRate: number | null;
  rxRate: number | null;
  retries: number | null;
  failed: number | null;
}

export interface SignalHistory {
  start: number;
  end: number;
  step: number;
  tier: SignalTier;
  points: SignalPoint[];
}

export interface SurveyRadio {
  ifname: string;
  phy: string;
  freq: number;
  channel: number;
  noise?: number;
  /** Share of the last minute the channel was busy, 0–100; null right after start. */
  busyPct: number | null;
  updated: number;
}

export interface SurveyChannel {
  phy: string;
  freq: number;
  channel: number;
  noise?: number;
  busyPct: number | null;
}

export interface Survey {
  radios: SurveyRadio[];
  channels: SurveyChannel[];
}

const MODES: readonly WifiMode[] = ['legacy', 'ht', 'vht', 'he'];

export function parseStations(raw: unknown): AgentStations {
  const r = obj(raw);
  return {
    ts: num(r.ts),
    liveUntil: num(r.live_until),
    interfaces: list(r.interfaces).map((x) => {
      const i = obj(x);
      return {
        ifname: str(i.ifname),
        phy: str(i.phy),
        ssid: str(i.ssid),
        bssid: optional(i.bssid) ? mac(i.bssid) : undefined,
        freq: num(i.freq),
        channel: num(i.channel),
        width: maybe(i.width),
        noise: maybe(i.noise),
        stations: num(i.stations),
      };
    }),
    stations: list(r.stations).map((x) => {
      const s = obj(x);
      return {
        mac: mac(s.mac),
        ifname: str(s.ifname),
        freq: num(s.freq),
        signal: num(s.signal),
        signalAvg: maybe(s.signal_avg),
        noise: maybe(s.noise),
        inactiveMs: num(s.inactive_ms),
        connectedSec: maybe(s.connected_sec),
        rxRate: maybe(s.rx_rate),
        txRate: maybe(s.tx_rate),
        rxMcs: maybe(s.rx_mcs),
        txMcs: maybe(s.tx_mcs),
        rxNss: maybe(s.rx_nss),
        txNss: maybe(s.tx_nss),
        width: maybe(s.width),
        mode: MODES.includes(s.mode as WifiMode) ? (s.mode as WifiMode) : undefined,
        rxBytes: maybe(s.rx_bytes),
        txBytes: maybe(s.tx_bytes),
        txRetries: maybe(s.tx_retries),
        txFailed: maybe(s.tx_failed),
        txPackets: maybe(s.tx_packets),
      };
    }),
  };
}

const TIERS: readonly SignalTier[] = ['live', 'minute', 'hour'];

export function parseSignal(raw: unknown): SignalHistory {
  const r = obj(raw);
  return {
    start: num(r.start),
    end: num(r.end),
    step: num(r.step),
    tier: TIERS.includes(r.tier as SignalTier) ? (r.tier as SignalTier) : 'minute',
    points: list(r.points)
      .filter((p): p is unknown[] => Array.isArray(p) && typeof p[0] === 'number')
      .map(([t, signal, minSignal, txRate, rxRate, retries, failed]) => ({
        t: t as number,
        signal: nullable(signal),
        minSignal: nullable(minSignal),
        txRate: nullable(txRate),
        rxRate: nullable(rxRate),
        retries: nullable(retries),
        failed: nullable(failed),
      })),
  };
}

export function parseSurvey(raw: unknown): Survey {
  const r = obj(raw);
  return {
    radios: list(r.radios).map((x) => {
      const s = obj(x);
      return {
        ifname: str(s.ifname),
        phy: str(s.phy),
        freq: num(s.freq),
        channel: num(s.channel),
        noise: maybe(s.noise),
        busyPct: nullable(s.busy_pct),
        updated: num(s.updated),
      };
    }),
    channels: list(r.channels).map((x) => {
      const s = obj(x);
      return {
        phy: str(s.phy),
        freq: num(s.freq),
        channel: num(s.channel),
        noise: maybe(s.noise),
        busyPct: nullable(s.busy_pct),
      };
    }),
  };
}

/** `live` renews the plugin's 30-second live lease: stations are then sampled every second. */
export async function agentStations(conn: RouterConnection, live = false): Promise<AgentStations> {
  return parseStations(await conn.call('routelink', 'stations', live ? { live: true } : {}));
}

export async function agentSignal(
  conn: RouterConnection,
  q: { mac: string; start: number; end: number; maxPoints?: number },
): Promise<SignalHistory> {
  const params: Record<string, unknown> = { mac: q.mac, start: q.start, end: q.end };
  if (q.maxPoints) params.max_points = q.maxPoints;
  try {
    return parseSignal(await conn.call('routelink', 'signal', params));
  } catch (error) {
    // A station the plugin has never seen simply has no history.
    if (error instanceof UbusError && error.code === 'NOT_FOUND') {
      return { start: q.start, end: q.end, step: 0, tier: 'minute', points: [] };
    }
    throw error;
  }
}

export async function agentSurvey(conn: RouterConnection): Promise<Survey> {
  return parseSurvey(await conn.call('routelink', 'survey'));
}
