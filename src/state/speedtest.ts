import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { SpeedResult } from '@/features/diagnostics/speed';

import { kvStorage } from './storage';

/** DG-4: phone speed tests (the router keeps its own) and the contracted bandwidth, per router. */
interface SpeedtestState {
  history: Record<string, SpeedResult[]>;
  /** Mbit/s the user pays for; compared against only when set. */
  contract: Record<string, { downMbps?: number; upMbps?: number }>;
  add(routerId: string, result: SpeedResult): void;
  setContract(routerId: string, contract: { downMbps?: number; upMbps?: number } | null): void;
}

const KEEP = 50;

export const useSpeedtests = create<SpeedtestState>()(
  persist(
    (set) => ({
      history: {},
      contract: {},
      add: (routerId, result) =>
        set((s) => ({
          history: { ...s.history, [routerId]: [result, ...(s.history[routerId] ?? [])].slice(0, KEEP) },
        })),
      setContract: (routerId, contract) =>
        set((s) => {
          const next = { ...s.contract };
          if (contract) next[routerId] = contract;
          else delete next[routerId];
          return { contract: next };
        }),
    }),
    { name: 'routelink.speedtests', version: 1, storage: kvStorage },
  ),
);
