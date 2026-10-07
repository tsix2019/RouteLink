import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { stageAndApply, type ApplyOutcome } from '@/api/uci';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';

import type { SyncStep } from './ssidSync';

export type StepResult =
  | { routerId: string; status: 'done'; outcome: ApplyOutcome }
  | { routerId: string; status: 'failed'; error: unknown }
  /** The AP's password is not known in this session. */
  | { routerId: string; status: 'skipped' };

/** Applies a multi-router plan (ssidSync.syncPlan) step by step, each router through its own connection. */
export function useGroupApply() {
  const { router, connection, group } = useActiveRouter();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);

  const connectionOf = (id: string) =>
    id === router?.id ? connection : (group.members.find((m) => m.id === id)?.connection ?? null);

  const run = async (steps: SyncStep[]): Promise<StepResult[]> => {
    setBusy(true);
    const results: StepResult[] = [];
    try {
      for (const step of steps) {
        const conn = connectionOf(step.routerId);
        if (!conn) {
          results.push({ routerId: step.routerId, status: 'skipped' });
          continue;
        }
        try {
          const outcome = await stageAndApply(conn, step.changes, { mode: step.mode });
          results.push({ routerId: step.routerId, status: 'done', outcome });
        } catch (error) {
          results.push({ routerId: step.routerId, status: 'failed', error });
        }
        void client.invalidateQueries({ queryKey: [step.routerId, 'radios'] });
      }
    } finally {
      setBusy(false);
    }
    return results;
  };

  return { run, busy };
}
