import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { LanguagePreference } from '@/i18n';
import { normalizeMac } from '@/utils/mac';

import { kvStorage } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type RefreshInterval = 1 | 2 | 5 | 10;

export interface WolEntry {
  name: string;
  mac: string;
}

interface SettingsData {
  language: LanguagePreference;
  theme: ThemePreference;
  refreshIntervalSec: RefreshInterval;
  /** Android only: draw glass without blur (iOS follows the system accessibility setting). */
  reduceTransparency: boolean;
  demoMode: boolean;
  wolList: WolEntry[];
}

interface SettingsState extends SettingsData {
  hydrated: boolean;
  set(patch: Partial<SettingsData>): void;
  addWol(entry: WolEntry): void;
  removeWol(mac: string): void;
}

export const DEFAULT_SETTINGS: SettingsData = {
  language: 'system',
  theme: 'system',
  refreshIntervalSec: 2,
  reduceTransparency: false,
  demoMode: false,
  wolList: [],
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,
      set: (patch) => set(patch),
      addWol: (entry) =>
        set((s) => {
          const mac = normalizeMac(entry.mac);
          if (!mac) return s;
          return { wolList: [...s.wolList.filter((w) => w.mac !== mac), { name: entry.name.trim() || mac, mac }] };
        }),
      removeWol: (mac) => set((s) => ({ wolList: s.wolList.filter((w) => w.mac !== mac) })),
    }),
    {
      name: 'routelink.settings',
      version: 1,
      storage: kvStorage,
      partialize: ({ language, theme, refreshIntervalSec, reduceTransparency, demoMode, wolList }) => ({
        language,
        theme,
        refreshIntervalSec,
        reduceTransparency,
        demoMode,
        wolList,
      }),
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);
