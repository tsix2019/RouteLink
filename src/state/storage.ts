import Storage from 'expo-sqlite/kv-store';
import { createJSONStorage } from 'zustand/middleware';

/** Non-secret app state lives in SQLite-backed key-value storage; secrets go to expo-secure-store. */
export const kvStorage = createJSONStorage(() => ({
  getItem: (key: string) => Storage.getItem(key),
  setItem: (key: string, value: string) => Storage.setItem(key, value),
  removeItem: (key: string) => Storage.removeItem(key),
}));
