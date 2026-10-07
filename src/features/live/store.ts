import { Platform } from 'react-native';
import RouteLinkNative, { type LiveMonitorState, type LiveMonitorSupport } from 'routelink-native';
import { create } from 'zustand';

import { useRouters, type RouterProfile } from '@/state/routers';

/** The live monitor is an Android foreground service (design §16). */
export const liveAvailable = Platform.OS === 'android';

interface LiveStore {
  /** What the service reports; null until read (and always on iOS). */
  state: LiveMonitorState | null;
  support: LiveMonitorSupport | null;
}

/** Shared by the overview's button and its "interrupted" notice. Nothing is persisted here: the service is the truth. */
export const useLiveStore = create<LiveStore>()(() => ({ state: null, support: null }));

export async function refreshLive(): Promise<void> {
  if (!liveAvailable) return;
  const [state, support] = await Promise.all([
    RouteLinkNative.getLiveMonitorState(),
    RouteLinkNative.getLiveMonitorSupport(),
  ]);
  useLiveStore.setState({ state, support });
}

/** The running monitor's state, when it watches this router. */
export function runningFor(state: LiveMonitorState | null, routerId: string | undefined): LiveMonitorState | null {
  return state?.running && routerId && state.routerId === routerId ? state : null;
}

const sameLogin = (a: RouterProfile, b: RouterProfile) =>
  a.baseUrl === b.baseUrl && a.username === b.username && a.tlsSha256 === b.tlsSha256;

/**
 * The monitored router was deleted, or its address or account changed: the service would keep polling it
 * with a session the app can never renew, so it stops (the overview may not even be mounted).
 */
if (liveAvailable) {
  useRouters.subscribe((next, prev) => {
    if (next.routers === prev.routers) return;
    const changed = prev.routers.filter((p) => {
      const now = next.routers.find((r) => r.id === p.id);
      return !now || !sameLogin(now, p);
    });
    if (!changed.length) return;
    void RouteLinkNative.getLiveMonitorState()
      .then(async (state) => {
        if (!state.running || !changed.some((r) => r.id === state.routerId)) return;
        await RouteLinkNative.stopLiveMonitor();
        await refreshLive();
      })
      .catch(() => undefined);
  });
}
