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

/** After installing, upgrading, removing or resetting the plugin. */
export function useInvalidateAgent(): () => Promise<void> {
  const client = useQueryClient();
  const { router } = useActiveRouter();
  return useCallback(
    () => client.invalidateQueries({ queryKey: [router?.id ?? 'none', AGENT_KEY] }),
    [client, router?.id],
  );
}
