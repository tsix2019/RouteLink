import { create } from 'zustand';

import type { RouterConnection } from '@/api/connection/types';

import { demoInstallDeps } from './demoInstall';
import { installAgent, type InstallStep } from './install';

export interface InstallSessionState {
  /** Router being installed on; the install screen ignores sessions of other routers. */
  routerId: string | null;
  running: boolean;
  /** Every step reported so far, in order. */
  steps: InstallStep[];
  last: InstallStep | null;
  start(conn: RouterConnection, mirror: string): Promise<InstallStep>;
  reset(): void;
}

/**
 * The running one-tap install, outside any screen: it keeps going when the install screen is left and
 * re-entered, and screens just render its steps.
 */
export const useInstallSession = create<InstallSessionState>()((set, get) => ({
  routerId: null,
  running: false,
  steps: [],
  last: null,
  async start(conn, mirror) {
    if (get().running) return get().last ?? { step: 'detect' };
    set({ routerId: conn.routerId, running: true, steps: [], last: null });
    // Loaded lazily: expo-crypto and expo/fetch are native modules that unit tests of other code don't need.
    const { networkInstallDeps, sha256Hex } = await import('./download');
    const deps = conn.kind === 'demo' ? { ...demoInstallDeps(sha256Hex), sha256: sha256Hex } : networkInstallDeps;
    const result = await installAgent(
      {
        conn,
        ...deps,
        onStep: (step) => set((s) => ({ steps: [...s.steps, step], last: step })),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      mirror,
    );
    set({ running: false });
    return result;
  },
  reset: () => set({ routerId: null, running: false, steps: [], last: null }),
}));
