import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  agentEvents,
  agentHistory,
  agentLive,
  agentSummary,
  getAgentDevices,
  getAgentStatus,
  type EventsQuery,
  type HistoryQuery,
  type Live,
  type SummaryQuery,
} from '@/api/services/agent';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';

import { useRouterQuery } from './router-queries';

/** Every plugin query starts with this key, so one invalidation refreshes them all. */
export const AGENT_KEY = 'agent';

export const useAgentStatus = () => useRouterQuery([AGENT_KEY, 'status'], getAgentStatus, { staleTime: 60_000 });

export const useAgentDevices = (enabled: boolean) =>
  useRouterQuery([AGENT_KEY, 'devices'], getAgentDevices, { refetchInterval: 10_000, enabled });

/** Polling renews the plugin's live lease, so it only runs while a screen that shows it is focused. */
export const useAgentLive = (enabled: boolean) =>
  useRouterQuery([AGENT_KEY, 'live'], agentLive, { refetchInterval: 2_000, enabled, staleTime: 0 });

export const useTrafficSummary = (q: SummaryQuery | null) =>
  useRouterQuery([AGENT_KEY, 'summary', q], (c) => agentSummary(c, q!), { enabled: !!q, staleTime: 30_000 });

export const useTrafficHistory = (q: HistoryQuery | null) =>
  useRouterQuery([AGENT_KEY, 'history', q], (c) => agentHistory(c, q!), { enabled: !!q, staleTime: 30_000 });

export const useAgentEvents = (q: EventsQuery | null) =>
  useRouterQuery([AGENT_KEY, 'events', q], (c) => agentEvents(c, q!), { enabled: !!q, staleTime: 30_000 });

/** Live samples per router and device, kept for the whole app session like the WAN rate tracker. */
const liveHistory = new Map<string, Map<string, number[]>>();
export const LIVE_POINTS = 60;

export interface LiveTraffic {
  live: Live;
  /** Last download rates (bits/s) per MAC, oldest first. */
  history: Record<string, number[]>;
}

/** `useAgentLive` plus a short per-device history for sparklines (filled inside the query function). */
export function useLiveTraffic(enabled: boolean) {
  const { router } = useActiveRouter();
  const key = router?.id ?? 'none';
  return useRouterQuery(
    [AGENT_KEY, 'live-traffic'],
    async (conn): Promise<LiveTraffic> => {
      const live = await agentLive(conn);
      let perDevice = liveHistory.get(key);
      if (!perDevice) liveHistory.set(key, (perDevice = new Map()));
      const seen = new Set<string>();
      for (const d of live.devices) {
        seen.add(d.mac);
        const series = perDevice.get(d.mac) ?? [];
        series.push(d.rxBps);
        if (series.length > LIVE_POINTS) series.splice(0, series.length - LIVE_POINTS);
        perDevice.set(d.mac, series);
      }
      // Devices that went quiet keep scrolling with zeros.
      for (const [mac, series] of perDevice) {
        if (seen.has(mac)) continue;
        series.push(0);
        if (series.length > LIVE_POINTS) series.splice(0, series.length - LIVE_POINTS);
      }
      return { live, history: Object.fromEntries([...perDevice].map(([mac, s]) => [mac, [...s]])) };
    },
    { refetchInterval: 2_000, enabled, staleTime: 0 },
  );
}

/** After installing, upgrading, removing or resetting the plugin. */
export function useInvalidateAgent(): () => Promise<void> {
  const client = useQueryClient();
  const { router } = useActiveRouter();
  return useCallback(
    () => client.invalidateQueries({ queryKey: [router?.id ?? 'none', AGENT_KEY] }),
    [client, router?.id],
  );
}
