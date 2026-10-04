import { create } from 'zustand';

/** The new SSID and password, shown once on the reconnect screen. In memory only, never persisted. */
export const useReconnectDraft = create<{ ssid: string; key?: string; set(ssid: string, key?: string): void }>()(
  (set) => ({
    ssid: '',
    key: undefined,
    set: (ssid, key) => set({ ssid, key }),
  }),
);
