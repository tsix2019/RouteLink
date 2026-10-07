import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { normalizeMac } from '@/utils/mac';

import { kvStorage } from './storage';

/**
 * Trusted devices of routers without the plugin (WF-3), per gateway. With the plugin they live in the
 * router's UCI instead and this list is moved there (features/wifi-tools/trust.ts).
 */
interface TrustState {
  trusted: Record<string, string[]>;
  setTrusted(routerId: string, macs: string[], trusted: boolean): void;
  clear(routerId: string): void;
}

export const useLocalTrust = create<TrustState>()(
  persist(
    (set) => ({
      trusted: {},
      setTrusted: (routerId, macs, trusted) =>
        set((s) => {
          const current = new Set(s.trusted[routerId] ?? []);
          for (const m of macs) {
            const mac = normalizeMac(m);
            if (!mac) continue;
            if (trusted) current.add(mac);
            else current.delete(mac);
          }
          return { trusted: { ...s.trusted, [routerId]: [...current].sort() } };
        }),
      clear: (routerId) =>
        set((s) => {
          const next = { ...s.trusted };
          delete next[routerId];
          return { trusted: next };
        }),
    }),
    { name: 'routelink.trust', version: 1, storage: kvStorage },
  ),
);
