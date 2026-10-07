import Constants from 'expo-constants';

import { useSettings } from '@/state/settings';

import { githubFetchJson } from './github';
import { compareVersions, fetchLatestRelease, type AppRelease, type FetchJson } from './releases';

export const CHECK_INTERVAL_MS = 24 * 3600_000;

/** This app's version (app.config.ts). */
export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** Whether `latest` is newer than the version installed. */
export function hasUpdate(latest: Pick<AppRelease, 'version'> | null | undefined, current = currentVersion()): boolean {
  return !!latest && (compareVersions(latest.version, current) ?? 0) > 0;
}

/** The optional daily check: switched on, and a day since the last one (or the clock went back). */
export function shouldAutoCheck(s: { updateAutoCheck: boolean; updateCheckedAt: number }, now: number): boolean {
  return s.updateAutoCheck && (now - s.updateCheckedAt >= CHECK_INTERVAL_MS || now < s.updateCheckedAt);
}

/**
 * Look up the newest release and remember it (without its notes) with the time. Throws UpdateError;
 * a failed check changes nothing.
 */
export async function checkForUpdate({
  fetchJson = githubFetchJson,
  now = Date.now(),
  current = currentVersion(),
}: { fetchJson?: FetchJson; now?: number; current?: string } = {}): Promise<{ release: AppRelease; newer: boolean }> {
  const release = await fetchLatestRelease(fetchJson);
  const { notes: _notes, ...stored } = release;
  useSettings.getState().set({ updateLatest: stored, updateCheckedAt: now });
  return { release, newer: hasUpdate(release, current) };
}
