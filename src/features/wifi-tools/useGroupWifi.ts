import { useQueries, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import RouteLinkNative from 'routelink-native';

import type { RouterConnection } from '@/api/connection/types';
import { getApStations } from '@/api/group';
import { agentEvents, getAgentStatus, type AgentEventType } from '@/api/services/agent';
import { agentSignal, agentStations, type SignalHistory, type WifiMode } from '@/api/services/agent-wifi';
import { bandOfFreq, type Band } from '@/api/services/clients';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useMemberQuery } from '@/hooks/router-queries';

import { appendSample, LIVE_WINDOW_SEC, mergeHistories, mergeLive, samplesOf, type LiveSample } from './live';
import { roamingRecord, type RoamEntry } from './roaming';
import { parseWifiFeatures, type WifiFeatures } from './security';

/** Data hooks of the Wi-Fi tools across the routers of the active network group. */

export interface GroupRouter {
  id: string;
  name: string;
  connection: RouterConnection | null;
}

/** The active router and its group's access points (just the active router when it has none). */
export function useGroupRouters(): GroupRouter[] {
  const { router, connection, group } = useActiveRouter();
  if (!router) return [];
  return [
    { id: router.id, name: router.name, connection },
    ...group.members.map((m) => ({ id: m.id, name: m.name, connection: m.connection })),
  ];
}

export interface WifiPluginRouter extends GroupRouter {
  /** The plugin runs there with its Wi-Fi module: stations with live data, signal history, events. */
  wifi: boolean;
  loading: boolean;
}

/** Plugin status of every router of the group (same cache entries as useAgentStatus). */
export function useGroupWifiPlugins(): WifiPluginRouter[] {
  const routers = useGroupRouters();
  const statuses = useQueries({
    queries: routers.map((r) => ({
      queryKey: [r.id, AGENT_KEY, 'status'],
      queryFn: () => getAgentStatus(r.connection!),
      enabled: !!r.connection,
      staleTime: 60_000,
    })),
  });
  return routers.map((r, i) => {
    const s = statuses[i];
    return {
      ...r,
      wifi: s.data?.state === 'ok' && s.data.info.modules.includes('wifi'),
      loading: !!r.connection && s.isLoading,
    };
  });
}

/** The phone's own IPv4 address, to find "this phone" in the device list. */
export function usePhoneIp(): string | null | undefined {
  return useQuery({
    queryKey: ['phone-network'],
    queryFn: () => RouteLinkNative.getNetworkInfo(),
    staleTime: 0,
    select: (info) => info.ip,
  }).data;
}

/**
 * Refetches every `ms` while the screen is focused, for lists whose shared query polls slower. An earlier
 * fetch still running is not cancelled, so a slow router is not asked again and again.
 */
export function usePollWhileFocused(refetch: (o: { cancelRefetch: boolean }) => unknown, ms: number) {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const id = setInterval(() => void refetch({ cancelRefetch: false }), ms);
    return () => clearInterval(id);
  }, [focused, ms, refetch]);
}

/** One station right now, from the plugin or from iwinfo. */
export interface StationNow {
  signal: number;
  noise?: number;
  /** kbit/s */
  rxRate?: number;
  txRate?: number;
  connectedSec?: number;
  band: Band;
  ssid: string;
  ifname: string;
  /** Plugin only. */
  width?: number;
  mode?: WifiMode;
  txRetries?: number;
  txFailed?: number;
  txPackets?: number;
}

export interface LiveStation {
  /** Router time (plugin) or phone time (iwinfo), epoch seconds. */
  now: number;
  /** The last five minutes. */
  samples: LiveSample[];
  /** null: the AP does not list the client right now. */
  station: StationNow | null;
  source: 'plugin' | 'iwinfo';
}

/** Samples per AP and client, kept for the app session like the traffic page's live rates. */
const buffers = new Map<string, LiveSample[]>();

async function sampleStation(
  conn: RouterConnection,
  mac: string,
  plugin: boolean,
): Promise<Omit<LiveStation, 'samples'>> {
  if (plugin) {
    // `live` renews the plugin's live lease: it samples stations every second while the page polls.
    const r = await agentStations(conn, true);
    const s = r.stations.find((x) => x.mac === mac);
    const iface = s ? r.interfaces.find((i) => i.ifname === s.ifname) : undefined;
    return {
      now: r.ts || Math.floor(Date.now() / 1000),
      source: 'plugin',
      station: s
        ? {
            signal: s.signal,
            noise: s.noise ?? iface?.noise,
            rxRate: s.rxRate,
            txRate: s.txRate,
            connectedSec: s.connectedSec,
            band: bandOfFreq(s.freq || iface?.freq || 0),
            ssid: iface?.ssid ?? '',
            ifname: s.ifname,
            width: s.width ?? iface?.width,
            mode: s.mode,
            txRetries: s.txRetries,
            txFailed: s.txFailed,
            txPackets: s.txPackets,
          }
        : null,
    };
  }
  const report = await getApStations(conn);
  const s = report.stations.find((x) => x.mac === mac);
  return {
    now: Math.floor(Date.now() / 1000),
    source: 'iwinfo',
    station: s
      ? {
          signal: s.signal,
          noise: s.noise,
          rxRate: s.rxRate,
          txRate: s.txRate,
          connectedSec: s.connectedSec,
          band: s.band,
          ssid: s.ssid,
          ifname: s.ifname,
        }
      : null,
  };
}

/**
 * A client's live signal on the router it is associated with: every second with the plugin (renewing its
 * live lease), every 2 seconds from iwinfo without it. With the plugin the chart starts with what the
 * router remembers of the last five minutes.
 */
export function useLiveStation(routerId: string | undefined, mac: string, plugin: boolean, enabled: boolean) {
  const key = `${routerId ?? 'none'}:${mac}`;
  const live = useMemberQuery(
    routerId,
    ['wifi-tools', 'live', mac, plugin ? 'plugin' : 'iwinfo'],
    async (conn): Promise<LiveStation> => {
      const r = await sampleStation(conn, mac, plugin);
      const sample: LiveSample = r.station
        ? { t: r.now, signal: r.station.signal, txRate: r.station.txRate ?? null, rxRate: r.station.rxRate ?? null }
        : { t: r.now, signal: null, txRate: null, rxRate: null };
      const samples = appendSample(buffers.get(key) ?? [], sample, r.now);
      buffers.set(key, samples);
      return { ...r, samples };
    },
    { enabled, refetchInterval: plugin ? 1_000 : 2_000, staleTime: 0 },
  );
  const data = live.data;
  // The plugin keeps its per-second points for the last minutes of ITS clock (the live tier only applies
  // within 600 s of the router's now): ask relative to the time its first answer carried, not the phone's.
  const routerNow = data?.source === 'plugin' ? data.now : undefined;
  const seed = useMemberQuery(
    routerId,
    [AGENT_KEY, 'signal', mac, 'live-seed'],
    (conn) => agentSignal(conn, { mac, start: routerNow! - LIVE_WINDOW_SEC, end: routerNow! }),
    { enabled: enabled && plugin && routerNow !== undefined, staleTime: 0 },
  );
  // Seed and samples are both on the router's clock.
  const samples = data ? mergeLive(seed.data ? samplesOf(seed.data.points) : [], data.samples, data.now) : [];
  return { data, samples, error: live.error, isLoading: live.isLoading };
}

/** Signal history of a client from every router that records it, merged (it may have roamed). */
export function useSignalHistory(routers: readonly GroupRouter[], mac: string, start: number, end: number) {
  const results = useQueries({
    queries: routers.map((r) => ({
      queryKey: [r.id, AGENT_KEY, 'signal', mac, start, end],
      queryFn: () => agentSignal(r.connection!, { mac, start, end, maxPoints: 300 }),
      enabled: !!r.connection,
      staleTime: 30_000,
    })),
  });
  const done = results.filter((q) => q.data).map((q) => q.data as SignalHistory);
  return {
    history: done.length ? mergeHistories(done) : null,
    isLoading: results.some((q) => q.isLoading),
    error: results.find((q) => q.error)?.error ?? null,
  };
}

const ROAM_TYPES: AgentEventType[] = ['wifi_connect', 'wifi_disconnect'];

/** The roaming record: connect and disconnect events of every router that samples Wi-Fi. */
export function useRoaming(
  routers: readonly GroupRouter[],
  mac: string,
  start: number,
  end: number,
): { entries: RoamEntry[]; isLoading: boolean } {
  const q = { mac, start, end, types: ROAM_TYPES, limit: 200 };
  const results = useQueries({
    queries: routers.map((r) => ({
      queryKey: [r.id, AGENT_KEY, 'events', q],
      queryFn: () => agentEvents(r.connection!, q),
      enabled: !!r.connection,
      staleTime: 30_000,
    })),
  });
  const sources = routers.flatMap((r, i) => {
    const events = results[i].data?.events;
    return events ? [{ routerId: r.id, name: r.name, events }] : [];
  });
  return { entries: roamingRecord(sources, mac), isLoading: results.some((x) => x.isLoading) };
}

/** What each router's hostapd supports (`luci getFeatures`); empty where it cannot be read. */
export function useWifiFeatures(routers: readonly GroupRouter[]): Record<string, WifiFeatures> {
  const results = useQueries({
    queries: routers.map((r) => ({
      queryKey: [r.id, 'wifi-features'],
      queryFn: () =>
        r
          .connection!.call('luci', 'getFeatures')
          .then(parseWifiFeatures)
          .catch((): WifiFeatures => ({})),
      enabled: !!r.connection,
      staleTime: 5 * 60_000,
    })),
  });
  return Object.fromEntries(routers.flatMap((r, i) => (results[i].data ? [[r.id, results[i].data!]] : [])));
}
