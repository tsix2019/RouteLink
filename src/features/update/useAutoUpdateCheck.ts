import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSettings } from '@/state/settings';

import { checkForUpdate, shouldAutoCheck } from './check';

let running: Promise<unknown> | null = null;

/** The daily check, if it is due: in the background, one at a time; failing quietly (it tries again later). */
export function autoCheckIfDue(now = Date.now(), check: () => Promise<unknown> = checkForUpdate): void {
  if (running || !shouldAutoCheck(useSettings.getState(), now)) return;
  running = check()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
}

/** Root layout: the optional daily check when the app starts and whenever it comes back to the front. */
export function useAutoUpdateCheck() {
  const hydrated = useSettings((s) => s.hydrated);
  const enabled = useSettings((s) => s.updateAutoCheck);
  useEffect(() => {
    if (!hydrated || !enabled) return;
    autoCheckIfDue();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') autoCheckIfDue();
    });
    return () => sub.remove();
  }, [hydrated, enabled]);
}
