import type { RouterConnection } from '@/api/connection/types';
import { getAgentStatus } from '@/api/services/agent';
import {
  PackageError,
  detectPackageEnv,
  installUploaded,
  trustApkKey,
  updateLists,
  writeFileChunks,
} from '@/api/services/packages';

import { ROUTELINK_APK_PEM } from './keys';
import { MANIFEST_URL, applyMirror, parseManifest, pickTarget, type ManifestFile } from './manifest';

export type InstallFailure =
  | 'router'
  | 'not-root'
  | 'no-helper'
  | 'unsupported-release'
  | 'unsupported-arch'
  | 'no-space'
  | 'download'
  | 'checksum'
  | 'upload'
  | 'lists'
  | 'dependencies'
  | 'install'
  | 'verify';

export type InstallStep =
  | { step: 'detect' }
  | { step: 'manifest' }
  | { step: 'download'; index: number; total: number }
  | { step: 'lists' }
  | { step: 'upload'; index: number; total: number; sent: number; size: number }
  | { step: 'install'; index: number; total: number }
  | { step: 'verify' }
  | { step: 'done'; version: string }
  | { step: 'failed'; reason: InstallFailure; detail?: string };

/** Everything outside the router connection is injected, so the flow is testable without a network. */
export interface InstallDeps {
  conn: RouterConnection;
  fetchManifest(url: string): Promise<unknown>;
  download(url: string): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<string>;
  onStep(step: InstallStep): void;
  sleep(ms: number): Promise<void>;
}

/** Room for the package, its unpacked files and opkg's temporary copy. */
const SPACE_FACTOR = 3;
const VERIFY_ATTEMPTS = 15;

class Failed extends Error {
  constructor(
    readonly reason: InstallFailure,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Package names opkg and apk say they cannot find. */
export function missingDependencies(output: string): string[] {
  const names = new Set<string>();
  for (const m of output.matchAll(/cannot find dependency (\S+)/gi)) names.add(m[1]);
  for (const m of output.matchAll(/^\s*(\S+) \(no such package\)/gim)) names.add(m[1]);
  // opkg lists them under "Cannot satisfy the following dependencies", one per " * <tab>name" line.
  for (const m of output.matchAll(/^\s*\*[ ]*\t(\S+)/gm)) names.add(m[1]);
  return [...names];
}

const isDependencyFailure = (output: string) =>
  /cannot find dependency|unable to select packages|cannot satisfy the following dependencies/i.test(output);

/**
 * One-tap install (design §13.3): detect the router, pick the matching packages from the release manifest,
 * download and verify all of them on the phone, then upload and install them one by one through LuCI's
 * package helper, and wait for the plugin to answer. Resolves with the last step: done or failed.
 */
export async function installAgent(deps: InstallDeps, mirror?: string): Promise<InstallStep> {
  const { conn, onStep } = deps;
  try {
    onStep({ step: 'detect' });
    let env;
    try {
      env = await detectPackageEnv(conn);
    } catch (error) {
      throw new Failed('router', message(error));
    }
    if ('unsupported' in env) {
      throw new Failed(
        env.unsupported === 'no-permission' ? 'not-root' : env.unsupported === 'no-helper' ? 'no-helper' : 'unsupported-release',
      );
    }

    onStep({ step: 'manifest' });
    let files: ManifestFile[];
    try {
      const picked = pickTarget(parseManifest(await deps.fetchManifest(applyMirror(MANIFEST_URL, mirror))), env);
      if (typeof picked === 'string') throw new Failed(picked);
      files = picked;
    } catch (error) {
      throw error instanceof Failed ? error : new Failed('download', message(error));
    }

    const needKb = Math.ceil((files.reduce((sum, f) => sum + f.size, 0) * SPACE_FACTOR) / 1024);
    if (needKb > env.freeKb) throw new Failed('no-space', `${needKb}/${env.freeKb}`);

    // Everything is downloaded and checked before the router is touched.
    const payloads: Uint8Array[] = [];
    for (const [index, file] of files.entries()) {
      onStep({ step: 'download', index, total: files.length });
      let bytes: Uint8Array;
      try {
        bytes = await deps.download(applyMirror(file.url, mirror));
      } catch (error) {
        throw new Failed('download', message(error));
      }
      if ((await deps.sha256(bytes)).toLowerCase() !== file.sha256) throw new Failed('checksum', file.name);
      payloads.push(bytes);
    }

    if (!env.hasLists) {
      onStep({ step: 'lists' });
      await updateLists(conn, env);
    }
    if (env.manager === 'apk') {
      try {
        await trustApkKey(conn, ROUTELINK_APK_PEM);
      } catch (error) {
        throw new Failed('install', message(error));
      }
    }

    for (const [index, bytes] of payloads.entries()) {
      const total = payloads.length;
      onStep({ step: 'upload', index, total, sent: 0, size: bytes.length });
      await writeFileChunks(conn, env.uploadPath, bytes, undefined, (sent) =>
        onStep({ step: 'upload', index, total, sent, size: bytes.length }),
      );
      onStep({ step: 'install', index, total });
      const result = await installUploaded(conn, env);
      if (!result.ok) {
        if (isDependencyFailure(result.output)) {
          throw new Failed('dependencies', missingDependencies(result.output).join(', ') || result.output);
        }
        throw new Failed('install', result.output);
      }
    }

    onStep({ step: 'verify' });
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      const status = await getAgentStatus(conn).catch(() => null);
      if (status?.state === 'ok') {
        const done: InstallStep = { step: 'done', version: status.info.version };
        onStep(done);
        return done;
      }
      await deps.sleep(1_000);
    }
    throw new Failed('verify');
  } catch (error) {
    const failed: InstallStep =
      error instanceof Failed
        ? { step: 'failed', reason: error.reason, ...(error.detail ? { detail: error.detail } : {}) }
        : error instanceof PackageError
          ? { step: 'failed', reason: error.reason === 'remove' ? 'install' : error.reason, ...(error.detail ? { detail: error.detail } : {}) }
          : { step: 'failed', reason: 'install', detail: message(error) };
    onStep(failed);
    return failed;
  }
}
