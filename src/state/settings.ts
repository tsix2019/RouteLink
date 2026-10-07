import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AppRelease } from '@/features/update/releases';
import type { LanguagePreference } from '@/i18n';
import { normalizeMac } from '@/utils/mac';

import { kvStorage } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type RefreshInterval = 1 | 2 | 5 | 10;

/** The newest release last found, kept without its notes (the update page fetches those again). */
export type StoredRelease = Omit<AppRelease, 'notes'>;

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
  /** Optional prefix for GitHub downloads: the router plugin, and the app's own APK. */
  agentMirror: string;
  /** Monthly reset day of the internet plan per router (WAN usage page). */
  wanResetDay: Record<string, number>;
  /** Routers whose "install the plugin" card on the overview was closed. */
  dismissedAgentCard: string[];
  /** SSH terminal font size (points). */
  terminalFontSize: number;
  /** Routers the background check watches (offline, back online, new devices). */
  notifyRouters: string[];
  /** Look for a new app version at most once a day (off: only when asked). */
  updateAutoCheck: boolean;
  /** Last successful look for a new version (ms), 0 for never. */
  updateCheckedAt: number;
  updateLatest: StoredRelease | null;
}

interface SettingsState extends SettingsData {
  hydrated: boolean;
  set(patch: Partial<SettingsData>): void;
  addWol(entry: WolEntry): void;
  removeWol(mac: string): void;
  setWanResetDay(routerId: string, day: number | null): void;
  dismissAgentCard(routerId: string): void;
}

export const DEFAULT_SETTINGS: SettingsData = {
  language: 'system',
  theme: 'system',
  refreshIntervalSec: 2,
  reduceTransparency: false,
  demoMode: false,
  wolList: [],
  agentMirror: '',
  wanResetDay: {},
  dismissedAgentCard: [],
  // OpenWrt's 53-column banner fits a phone at 12.
  terminalFontSize: 12,
  notifyRouters: [],
  updateAutoCheck: false,
  updateCheckedAt: 0,
  updateLatest: null,
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
      setWanResetDay: (routerId, day) =>
        set((s) => {
          const next = { ...s.wanResetDay };
          if (day === null) delete next[routerId];
          else next[routerId] = Math.min(31, Math.max(1, Math.round(day)));
          return { wanResetDay: next };
        }),
      dismissAgentCard: (routerId) =>
        set((s) => ({ dismissedAgentCard: [...new Set([...s.dismissedAgentCard, routerId])] })),
    }),
    {
      name: 'routelink.settings',
      version: 1,
      storage: kvStorage,
      partialize: ({
        language,
        theme,
        refreshIntervalSec,
        reduceTransparency,
        demoMode,
        wolList,
        agentMirror,
        wanResetDay,
        dismissedAgentCard,
        terminalFontSize,
        notifyRouters,
        updateAutoCheck,
        updateCheckedAt,
        updateLatest,
      }) => ({
        language,
        theme,
        refreshIntervalSec,
        reduceTransparency,
        demoMode,
        wolList,
        agentMirror,
        wanResetDay,
        dismissedAgentCard,
        terminalFontSize,
        notifyRouters,
        updateAutoCheck,
        updateCheckedAt,
        updateLatest,
      }),
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);
