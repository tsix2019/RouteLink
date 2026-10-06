import { useEffect, useState } from 'react';
import RouteLinkNative from 'routelink-native';

import type { RouterConnection } from '@/api/connection/types';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';

import { runDiagnosis, type SegmentResult } from './diagnose';
import { checkHttp204, prepareDiagnosis } from './prepare';

interface Run {
  round: number;
  conn: RouterConnection;
  results: SegmentResult[];
  plugin: boolean;
  startedAt: number;
  finishedAt?: number;
  error?: unknown;
}

export interface Diagnosis {
  results: SegmentResult[];
  running: boolean;
  plugin: boolean;
  startedAt?: number;
  finishedAt?: number;
  error?: unknown;
  /** Runs the whole diagnosis again. */
  rerun(): void;
}

/**
 * Runs the one-click diagnosis (DG-1) when the screen opens and whenever `rerun` is called; segments
 * arrive one by one. A run superseded by another (or by switching routers) stops reporting.
 */
export function useDiagnosis(): Diagnosis {
  const { router, connection, group } = useActiveRouter();
  const [round, setRound] = useState(0);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    if (!connection || !router) return;
    let alive = true;
    const startedAt = Date.now();
    const update = (fn: (r: Run) => Run) => {
      if (alive) setRun((r) => (r && r.round === round && r.conn === connection ? fn(r) : r));
    };
    (async () => {
      try {
        const { input } = await prepareDiagnosis({
          gateway: connection,
          gatewayRef: group.gateway ?? { id: router.id, name: router.name },
          members: group.members,
          phoneIp: () => RouteLinkNative.getNetworkInfo().then((info) => info.ip),
          http204: () => checkHttp204(fetch),
        });
        if (!alive) return;
        setRun({ round, conn: connection, results: [], plugin: input.plugin, startedAt });
        await runDiagnosis(input, (r) => update((s) => ({ ...s, results: [...s.results, r] })));
        update((s) => ({ ...s, finishedAt: Date.now() }));
      } catch (error) {
        if (alive)
          setRun({ round, conn: connection, results: [], plugin: false, startedAt, finishedAt: Date.now(), error });
      }
    })();
    return () => {
      alive = false;
    };
  }, [round, connection, router, group]);

  const current = run && run.round === round && run.conn === connection ? run : null;
  return {
    results: current?.results ?? [],
    running: !current?.finishedAt,
    plugin: current?.plugin ?? false,
    startedAt: current?.startedAt,
    finishedAt: current?.finishedAt,
    error: current?.error,
    rerun: () => setRound((r) => r + 1),
  };
}
