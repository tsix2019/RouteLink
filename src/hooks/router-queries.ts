import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { detectCapabilities } from '@/api/capabilities';
import { demoRateHistory } from '@/api/connection/demo/history';
import type { RouterConnection } from '@/api/connection/types';
import { getClients } from '@/api/services/clients';
import { kernelLog, systemLog } from '@/api/services/logs';
import { getDeviceCounters, getInterfaces, pickWan } from '@/api/services/network';
import { listServices } from '@/api/services/services';
import { getSystem, getTemperature } from '@/api/services/system';
import { RateTracker, type RatePoint } from '@/api/services/traffic';
import { getRadios } from '@/api/services/wireless';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useSettings } from '@/state/settings';

export interface RouterQueryOptions {
  /** Polling interval while the screen is focused; polling stops when it is not. */
  refetchInterval?: number;
  enabled?: boolean;
  staleTime?: number;
}

/** Query scoped to the active router: the key starts with its id, so routers never share data. */
export function useRouterQuery<T>(
  key: readonly unknown[],
  fn: (conn: RouterConnection) => Promise<T>,
  o: RouterQueryOptions = {},
) {
  const { connection, router } = useActiveRouter();
  const focused = useIsFocused();
  return useQuery({
    queryKey: [router?.id ?? 'none', ...key],
    queryFn: () => fn(connection!),
    enabled: !!connection && (o.enabled ?? true),
    refetchInterval: focused && o.refetchInterval ? o.refetchInterval : false,
    staleTime: o.staleTime,
  });
}

export const useSystem = () => useRouterQuery(['system'], getSystem, { refetchInterval: 5_000 });
export const useTemperature = (enabled: boolean) =>
  useRouterQuery(['temperature'], getTemperature, { refetchInterval: 30_000, enabled });
export const useInterfaces = () => useRouterQuery(['interfaces'], getInterfaces, { refetchInterval: 10_000 });
export const useClients = () => useRouterQuery(['clients'], getClients, { refetchInterval: 10_000 });
export const useDeviceCounters = () =>
  useRouterQuery(['device-counters'], getDeviceCounters, { refetchInterval: 10_000 });
export const useRadios = () => useRouterQuery(['radios'], getRadios);
export const useServices = () => useRouterQuery(['services'], listServices);
export const useSystemLog = () => useRouterQuery(['logs', 'system'], systemLog);
export const useKernelLog = () => useRouterQuery(['logs', 'kernel'], kernelLog);
export const useCapabilities = () => useRouterQuery(['capabilities'], detectCapabilities, { staleTime: Infinity });

/** Rate history per router + WAN device survives screen changes for the whole app session. */
const trackers = new Map<string, RateTracker>();

function trackerFor(key: string): RateTracker {
  let tracker = trackers.get(key);
  if (!tracker) {
    tracker = new RateTracker(60);
    trackers.set(key, tracker);
  }
  return tracker;
}

/** WAN rate series; each poll feeds the counters into the router's tracker inside the query function. */
export function useTraffic() {
  const intervalMs = useSettings((s) => s.refreshIntervalSec) * 1_000;
  const { router } = useActiveRouter();
  const wanDevice = pickWan(useInterfaces().data ?? [])?.device;
  const key = `${router?.id ?? 'none'}:${wanDevice ?? ''}`;
  const query = useRouterQuery(
    ['traffic', wanDevice],
    async (conn): Promise<readonly RatePoint[]> => {
      const tracker = trackerFor(key);
      if (conn.kind === 'demo') tracker.seed(demoRateHistory(59, intervalMs, Date.now()));
      const counters = (await getDeviceCounters(conn))[wanDevice ?? ''];
      if (counters) tracker.push(Date.now(), counters.rx, counters.tx);
      return [...tracker.series]; // copy: the tracker mutates in place
    },
    { refetchInterval: intervalMs, enabled: !!wanDevice, staleTime: 0 },
  );
  const series = query.data ?? [];
  return { series, latest: series[series.length - 1], wanDevice, isLoading: query.isLoading, error: query.error };
}

/** Mutation against the active router that refreshes the listed query keys afterwards. */
export function useRouterMutation<A, R>(
  fn: (conn: RouterConnection, args: A) => Promise<R>,
  invalidate: readonly (readonly unknown[])[],
) {
  const { connection, router } = useActiveRouter();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => {
      if (!connection) throw new Error('no router connection');
      return fn(connection, args);
    },
    onSettled: () =>
      Promise.all(invalidate.map((k) => client.invalidateQueries({ queryKey: [router?.id ?? 'none', ...k] }))),
  });
}
