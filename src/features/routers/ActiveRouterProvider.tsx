import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getDemoConnection, getLiveConnection } from '@/api/connection/manager';
import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import type { RouterConnection } from '@/api/connection/types';
import { activeProfile, useRouters, type RouterProfile } from '@/state/routers';
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

interface ActiveRouterContext {
  router: ActiveRouter | null;
  connection: RouterConnection | null;
  status: ActiveRouterStatus;
}

const Context = createContext<ActiveRouterContext>({ router: null, connection: null, status: 'none' });

export function ActiveRouterProvider({ children }: { children: ReactNode }) {
  const demoMode = useSettings((s) => s.demoMode);
  const routers = useRouters((s) => s.routers);
  const activeId = useRouters((s) => s.activeId);
  const getPassword = useRouters((s) => s.getPassword);
  const update = useRouters((s) => s.update);
  const profile = activeProfile(routers, activeId);

  const [password, setPassword] = useState<{ id: string; value: string | null } | null>(null);

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
      };
    }
    if (!profile) return { router: null, connection: null, status: 'none' };
    const router: ActiveRouter = {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      isDemo: false,
      profile,
    };
    if (!password || password.id !== profile.id) return { router, connection: null, status: 'loading' };
    if (password.value === null) return { router, connection: null, status: 'needs-password' };
    const connection = getLiveConnection(profile, password.value, (session) => {
      if (session.mode !== profile.authMode) void update(profile.id, { authMode: session.mode });
    });
    return { router, connection, status: 'ready' };
  }, [demoMode, profile, password, update]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useActiveRouter = () => useContext(Context);

/** For screens that only render once a router is ready. */
export function useConnection(): RouterConnection | null {
  return useContext(Context).connection;
}
