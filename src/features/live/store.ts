import { Platform } from 'react-native';
import RouteLinkNative, { type LiveMonitorState, type LiveMonitorSupport } from 'routelink-native';
import { create } from 'zustand';

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
