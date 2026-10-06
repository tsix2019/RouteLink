import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getDemoConnection, getLiveConnection } from '@/api/connection/manager';
import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import type { RouterConnection } from '@/api/connection/types';
import { apsOf, roleOf, type GroupMember, type MemberRef } from '@/api/group';
import { useRouters, type RouterProfile } from '@/state/routers';
import { useSettings } from '@/state/settings';

export interface ActiveRouter {
  id: string;
  name: string;
  baseUrl: string;
  isDemo: boolean;
  profile?: RouterProfile;
}

export type ActiveRouterStatus =
  /** No router configured and demo mode off. */
  | 'none'
  | 'loading'
  /** The password was not saved and has to be entered for this session. */
  | 'needs-password'
  | 'ready';

/** The network group of the active router (design §14); empty unless it is a gateway with access points. */
export interface ActiveGroup {
  gateway: MemberRef | null;
  /** Its access points; `connection` is null while an AP's password is unknown. */
  members: GroupMember[];
}

const NO_GROUP: ActiveGroup = { gateway: null, members: [] };

interface ActiveRouterContext {
  router: ActiveRouter | null;
  connection: RouterConnection | null;
  status: ActiveRouterStatus;
  group: ActiveGroup;
}

const Context = createContext<ActiveRouterContext>({ router: null, connection: null, status: 'none', group: NO_GROUP });

export function ActiveRouterProvider({ children }: { children: ReactNode }) {
  const demoMode = useSettings((s) => s.demoMode);
  const routers = useRouters((s) => s.routers);
  const activeId = useRouters((s) => s.activeId);
  const getPassword = useRouters((s) => s.getPassword);
  const update = useRouters((s) => s.update);
  // No (valid) selection yet: fall back to the most recently used router.
  const profile =
    routers.find((r) => r.id === activeId) ??
    [...routers].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0] ??
    null;

  const [password, setPassword] = useState<{ id: string; value: string | null } | null>(null);

  const aps = useMemo(
    () => (profile && roleOf(profile) === 'gateway' ? apsOf(routers, profile.id) : []),
    [profile, routers],
  );
  const [apPasswords, setApPasswords] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (!aps.length) return;
    let cancelled = false;
    Promise.all(aps.map(async (ap) => [ap.id, await getPassword(ap.id)] as const)).then((entries) => {
      if (!cancelled) setApPasswords(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // An AP's profile changes when its password is entered.
  }, [aps, getPassword]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    getPassword(profile.id).then((value) => {
      if (!cancelled) setPassword({ id: profile.id, value });
    });
    return () => {
      cancelled = true;
    };
    // Re-read when the profile changes (e.g. after re-entering a password).
  }, [profile, getPassword]);

  const value = useMemo<ActiveRouterContext>(() => {
    if (demoMode) {
      return {
        router: { id: DEMO_ROUTER_ID, name: 'RouteLink Demo', baseUrl: 'demo://openwrt-one', isDemo: true },
        connection: getDemoConnection(),
        status: 'ready',
        group: NO_GROUP,
      };
    }
    if (!profile) return { router: null, connection: null, status: 'none', group: NO_GROUP };
    const router: ActiveRouter = {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      isDemo: false,
      profile,
    };
    if (!password || password.id !== profile.id) return { router, connection: null, status: 'loading', group: NO_GROUP };
    if (password.value === null) return { router, connection: null, status: 'needs-password', group: NO_GROUP };
    const connect = (p: RouterProfile, value: string) =>
      getLiveConnection(p, value, (session) => {
        if (session.mode !== p.authMode) void update(p.id, { authMode: session.mode });
      });
    const connection = connect(profile, password.value);
    const group: ActiveGroup = aps.length
      ? {
          gateway: { id: profile.id, name: profile.name },
          members: aps.map((ap) => {
            const value = apPasswords.get(ap.id);
            return { id: ap.id, name: ap.name, connection: value ? connect(ap, value) : null };
          }),
        }
      : NO_GROUP;
    return { router, connection, status: 'ready', group };
  }, [demoMode, profile, password, update, aps, apPasswords]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useActiveRouter = () => useContext(Context);

/** For screens that only render once a router is ready. */
export function useConnection(): RouterConnection | null {
  return useContext(Context).connection;
}

/** The connection of the active router or one of its group's access points (null while unknown). */
export function useMemberConnection(routerId: string | undefined): RouterConnection | null {
  const { router, connection, group } = useContext(Context);
  if (!routerId || routerId === router?.id) return connection;
  return group.members.find((m) => m.id === routerId)?.connection ?? null;
}
