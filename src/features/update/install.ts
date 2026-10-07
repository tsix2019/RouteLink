import { applyMirror } from '@/features/agent/manifest';

import { UpdateError, type AppRelease } from './releases';

type Apk = NonNullable<AppRelease['apk']>;

/** The few things of expo-file-system's File this needs (fakes in tests). */
export interface ApkFile {
  readonly name: string;
  readonly exists: boolean;
  readonly size: number | null;
  /** Android: a content:// address other apps (the installer) may read. */
  readonly contentUri: string;
  bytes(): Promise<Uint8Array>;
  delete(): void;
}

export interface DownloadProgress {
  bytesWritten: number;
  /** -1 without a Content-Length. */
  totalBytes: number;
}

export interface ApkDeps {
  /** `name` in the updates folder of the cache. */
  file(name: string): ApkFile;
  download(
    url: string,
    file: ApkFile,
    options: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal },
  ): Promise<void>;
  sha256(bytes: Uint8Array): Promise<string>;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

function remove(file: ApkFile) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Left for cleanUpdates next time.
  }
}

/** The size of the release, and its SHA-256 when GitHub gave one (the system checks the signature). */
async function verified(file: ApkFile, apk: Apk, deps: ApkDeps): Promise<boolean> {
  if (!file.exists || file.size !== apk.size) return false;
  return !apk.sha256 || (await deps.sha256(await file.bytes())) === apk.sha256;
}

/**
 * The release's APK in the cache, verified: an earlier download when that still checks out, else a fresh
 * one (through the mirror, if set). Throws UpdateError 'download' or 'verify'; a cancelled download throws
 * its AbortError. Nothing partial or unverified is left behind.
 */
export async function prepareApk(
  apk: Apk,
  options: { mirror?: string; onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal },
  deps: ApkDeps,
): Promise<ApkFile> {
  const file = deps.file(apk.name);
  if (file.exists) {
    if (await verified(file, apk, deps)) return file;
    remove(file);
  }
  try {
    await deps.download(applyMirror(apk.url, options.mirror), file, {
      onProgress: options.onProgress,
      signal: options.signal,
    });
  } catch (e) {
    remove(file);
    if (isAbort(e) || options.signal?.aborted) throw e;
    throw new UpdateError('download', e instanceof Error ? e.message : String(e));
  }
  if (!(await verified(file, apk, deps))) {
    remove(file);
    throw new UpdateError('verify');
  }
  return file;
}

type Launch = (action: string, params: { data: string; type: string; flags: number }) => Promise<unknown>;

/** FLAG_GRANT_READ_URI_PERMISSION: the installer may read the file behind the content:// address. */
const GRANT_READ = 1;

/**
 * The system's package installer for the APK. The first time, Android asks to let this app install apps;
 * after allowing it, "Install" again goes through. Resolves when the user comes back.
 */
export async function openInstaller(file: ApkFile, launch: Launch): Promise<void> {
  try {
    await launch('android.intent.action.VIEW', {
      data: file.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: GRANT_READ,
    });
  } catch {
    throw new UpdateError('installer');
  }
}

/** Deletes the downloads in the updates folder except `keep` (the newest release's APK). */
export function cleanUpdates(list: () => Pick<ApkFile, 'name' | 'delete'>[], keep?: string): void {
  for (const f of list()) {
    if (f.name === keep) continue;
    try {
      f.delete();
    } catch {
      // In use or gone: next time.
    }
  }
}
