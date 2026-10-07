import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AuthMode } from '@/api/ubus/login';
import { normalizeBaseUrl } from '@/utils/url';

import { kvStorage } from './storage';

export interface RouterProfile {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  /** Detected on first login, then preferred. */
  authMode?: AuthMode;
  /** Pinned self-signed certificate (lower-case hex SHA-256). */
  tlsSha256?: string;
  savePassword: boolean;
  order: number;
  createdAt: number;
  lastUsedAt?: number;
  /** Last known model, for the switcher list. */
  model?: string;
  /** SSH (MO-12): port (22), user (root), how to log in (the router password), pinned host key "SHA256:…". */
  sshPort?: number;
  sshUser?: string;
  sshAuth?: 'password' | 'key';
  sshHostKey?: string;
  /** Network group (NG-1): a gateway with access points. Unset = standalone. */
  role?: RouterRole;
  /** For role 'ap': the gateway it belongs to. */
  gatewayId?: string;
}

export type RouterRole = 'gateway' | 'ap' | 'standalone';

export type NewRouter = Pick<RouterProfile, 'name' | 'baseUrl' | 'username' | 'savePassword'> &
  Partial<
    Pick<
      RouterProfile,
      'tlsSha256' | 'authMode' | 'model' | 'sshPort' | 'sshUser' | 'sshAuth' | 'sshHostKey' | 'role' | 'gatewayId'
    >
  >;

export const passwordKey = (id: string) => `router.${id}.password`;
const SECURE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** Passwords of routers with savePassword=false live only for this app session. */
const sessionPasswords = new Map<string, string>();

interface RoutersState {
  routers: RouterProfile[];
  activeId: string | null;
  hydrated: boolean;
  add(router: NewRouter, password?: string): Promise<RouterProfile>;
  /** password: undefined keeps it, null forgets it, a string replaces it. */
  update(id: string, patch: Partial<NewRouter>, password?: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): void;
  setActive(id: string | null): void;
  getPassword(id: string): Promise<string | null>;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function storePassword(id: string, password: string, save: boolean) {
  if (save) {
    await SecureStore.setItemAsync(passwordKey(id), password, SECURE_OPTIONS);
    sessionPasswords.delete(id);
  } else {
    sessionPasswords.set(id, password);
    await SecureStore.deleteItemAsync(passwordKey(id));
  }
}

export const useRouters = create<RoutersState>()(
  persist(
    (set, get) => ({
      routers: [],
      activeId: null,
      hydrated: false,

      async add(input, password) {
        const router: RouterProfile = {
          ...input,
          baseUrl: normalizeBaseUrl(input.baseUrl),
          name: input.name.trim() || input.baseUrl,
          id: newId(),
          order: get().routers.length,
          createdAt: Date.now(),
        };
        if (password !== undefined) await storePassword(router.id, password, router.savePassword);
        set((s) => ({ routers: [...s.routers, router] }));
        return router;
      },

      async update(id, patch, password) {
        const current = get().routers.find((r) => r.id === id);
        if (!current) return;
        const next: RouterProfile = {
          ...current,
          ...patch,
          ...(patch.baseUrl ? { baseUrl: normalizeBaseUrl(patch.baseUrl) } : {}),
        };
        if (password === null) {
          sessionPasswords.delete(id);
          await SecureStore.deleteItemAsync(passwordKey(id));
        } else if (password !== undefined) {
          await storePassword(id, password, next.savePassword);
        } else if (patch.savePassword !== undefined && patch.savePassword !== current.savePassword) {
          const existing = await get().getPassword(id);
          if (existing !== null) await storePassword(id, existing, next.savePassword);
        }
        set((s) => ({ routers: s.routers.map((r) => (r.id === id ? next : r)) }));
      },

      async remove(id) {
        sessionPasswords.delete(id);
        await SecureStore.deleteItemAsync(passwordKey(id));
        set((s) => {
          const routers = s.routers
            .filter((r) => r.id !== id)
            // Its access points become standalone routers again.
            .map((r) => (r.gatewayId === id ? { ...r, role: 'standalone' as const, gatewayId: undefined } : r))
            .map((r, order) => ({ ...r, order }));
          return { routers, activeId: s.activeId === id ? (routers[0]?.id ?? null) : s.activeId };
        });
      },

      reorder(ids) {
        set((s) => {
          const byId = new Map(s.routers.map((r) => [r.id, r]));
          const ordered = ids.map((id) => byId.get(id)).filter((r): r is RouterProfile => !!r);
          const rest = s.routers.filter((r) => !ids.includes(r.id));
          return { routers: [...ordered, ...rest].map((r, order) => ({ ...r, order })) };
        });
      },

      setActive(id) {
        set((s) => ({
          activeId: id,
          routers: s.routers.map((r) => (r.id === id ? { ...r, lastUsedAt: Date.now() } : r)),
        }));
      },

      async getPassword(id) {
        return sessionPasswords.get(id) ?? (await SecureStore.getItemAsync(passwordKey(id)));
      },
    }),
    {
      name: 'routelink.routers',
      version: 1,
      storage: kvStorage,
      partialize: ({ routers, activeId }) => ({ routers, activeId }),
      onRehydrateStorage: () => () => useRouters.setState({ hydrated: true }),
    },
  ),
);

export const sortedRouters = (routers: RouterProfile[]) => [...routers].sort((a, b) => a.order - b.order);

/** The router the app opens on: the selected one, else (no valid selection yet) the most recently used. */
export const activeProfile = (routers: RouterProfile[], activeId: string | null): RouterProfile | null =>
  routers.find((r) => r.id === activeId) ??
  [...routers].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0] ??
  null;
