import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { kvStorage } from './storage';

/** Last known overview of a router: shown instantly on cold start and when switching routers. */
export interface RouterSnapshot {
  updatedAt: number;
  model?: string;
  firmware?: string;
  hostname?: string;
  uptimeSec?: number;
  wanUp?: boolean;
  wanIp?: string;
  clientsOnline?: number;
  clientsTotal?: number;
}

interface SnapshotsState {
  byRouter: Record<string, RouterSnapshot>;
  save(routerId: string, patch: Omit<RouterSnapshot, 'updatedAt'>): void;
  forget(routerId: string): void;
}

export const useSnapshots = create<SnapshotsState>()(
  persist(
    (set) => ({
      byRouter: {},
      save: (routerId, patch) =>
        set((s) => ({
          byRouter: { ...s.byRouter, [routerId]: { ...s.byRouter[routerId], ...patch, updatedAt: Date.now() } },
        })),
      forget: (routerId) =>
        set((s) => {
          const { [routerId]: _removed, ...rest } = s.byRouter;
          return { byRouter: rest };
        }),
    }),
    { name: 'routelink.snapshots', version: 1, storage: kvStorage, partialize: ({ byRouter }) => ({ byRouter }) },
  ),
);
