import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';

import { sha256Hex } from '@/features/agent/download';

import { cleanUpdates, openInstaller, type ApkDeps, type ApkFile } from './install';

/** Downloaded APKs live in the cache: the system may clear it, and the next "Download" fetches again. */
function updatesDir(): Directory {
  const dir = new Directory(Paths.cache, 'updates');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** expo-file-system and expo-crypto behind prepareApk (Android only). */
export const apkDeps: ApkDeps = {
  file: (name) => new File(updatesDir(), name),
  download: async (url, file, { onProgress, signal }) => {
    await File.downloadFileAsync(url, file as File, { idempotent: true, onProgress, signal });
  },
  // The APK is about 35 MB: read whole, as the online firmware update does with its image.
  sha256: sha256Hex,
};

export const installApk = (file: ApkFile) => openInstaller(file, startActivityAsync);

/** Keeps only `keep` (the newest release's APK) in the updates folder. */
export const cleanApks = (keep?: string) =>
  cleanUpdates(
    () =>
      updatesDir()
        .list()
        .filter((e): e is File => e instanceof File),
    keep,
  );
