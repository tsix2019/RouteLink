import { useEffect, useMemo, useRef } from 'react';

import { useAgentStatus } from '@/hooks/agent-queries';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLocalTrust } from '@/state/trust';

import { getDeviceMarks, migrationUpdates, setDeviceMarks, type MarkUpdate } from './trust';

const EMPTY: string[] = [];
const TRUST = [['trust'], ['agent', 'devices']] as const;

/**
 * The active router's trust list from wherever it lives (the plugin's UCI or the app), and the local
 * list moved to the router once the plugin is there.
 */
export function useTrust() {
  const { router, connection } = useActiveRouter();
  const routerId = router?.id ?? 'none';
  const status = useAgentStatus();
  const plugin = status.data?.state === 'ok';
  const marks = useRouterQuery(['trust'], getDeviceMarks, { enabled: plugin });
  const local = useLocalTrust((s) => s.trusted[routerId]) ?? EMPTY;
  const setLocal = useLocalTrust((s) => s.setTrusted);
  const clearLocal = useLocalTrust((s) => s.clear);
  const write = useRouterMutation((conn, updates: MarkUpdate[]) => setDeviceMarks(conn, updates), TRUST);

  // One try per router while mounted: a failed move (no write access, router gone) keeps the local list
  // for the next visit instead of retrying on every render.
  const tried = useRef(new Set<string>());
  const data = marks.data;
  const refetch = marks.refetch;
  useEffect(() => {
    if (!plugin || !data || !local.length || !connection || tried.current.has(routerId)) return;
    tried.current.add(routerId);
    const updates = migrationUpdates(local, data);
    (updates.length ? setDeviceMarks(connection, updates) : Promise.resolve())
      .then(() => {
        clearLocal(routerId);
        return refetch();
      })
      .catch(() => undefined);
  }, [plugin, data, refetch, local, connection, clearLocal, routerId]);

  const trusted = useMemo(
    () => new Set(plugin ? (marks.data ?? []).filter((m) => m.trusted).map((m) => m.mac) : local),
    [plugin, marks.data, local],
  );
  const watched = useMemo(
    () => new Set(plugin ? (marks.data ?? []).filter((m) => m.watch).map((m) => m.mac) : []),
    [plugin, marks.data],
  );

  return {
    source: plugin ? ('plugin' as const) : ('local' as const),
    ready: !status.isLoading && (!plugin || !!marks.data),
    trusted,
    watched,
    busy: write.isPending,
    setTrusted: (macs: string[], value: boolean) =>
      plugin
        ? write.mutateAsync(macs.map((mac) => ({ mac, trusted: value })))
        : Promise.resolve(setLocal(routerId, macs, value)),
    /** Plugin only: push a notice when the device comes and goes. */
    setWatch: (mac: string, value: boolean) => write.mutateAsync([{ mac, watch: value }]),
  };
}
