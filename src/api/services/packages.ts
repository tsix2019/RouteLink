import { bytesToBase64 } from '@/utils/base64';

import type { RouterConnection } from '../connection/types';
import type { UbusCall, UbusResult } from '../ubus/types';

/**
 * Package management through LuCI's own package page permissions (rpcd allows nothing else): its helper
 * script for update/install/remove, its upload path for local packages. Measured on 23.05, 24.10 and 25.12
 * (execution log T28 of the P1 plan).
 */
export interface PackageEnv {
  /** "24.10", from `system board`. */
  release: string;
  /** Package architecture, e.g. "x86_64", from the distfeeds URLs (os-release is not readable). */
  arch: string;
  manager: 'opkg' | 'apk';
  helper: typeof PACKAGE_MANAGER_CALL | typeof OPKG_CALL;
  uploadPath: '/tmp/upload.ipk' | '/tmp/upload.apk';
  /** 23.05's ACL only allows "update *", so it gets an argument the helper drops. */
  updateArgs: string[];
  /** Free space on the root (overlay) filesystem. */
  freeKb: number;
  hasLists: boolean;
}

export type PackageEnvResult = PackageEnv | { unsupported: 'no-helper' | 'not-openwrt' | 'no-permission' };

export type PackageFailure = 'upload' | 'lists' | 'install' | 'remove';

export class PackageError extends Error {
  constructor(
    readonly reason: PackageFailure,
    readonly detail = '',
  ) {
    super(`${reason}${detail ? `: ${detail}` : ''}`);
    this.name = 'PackageError';
  }
}

/** luci-app-package-manager (24.10+). */
export const PACKAGE_MANAGER_CALL = '/usr/libexec/package-manager-call';
/** luci-app-opkg (23.05 and older). */
export const OPKG_CALL = '/usr/libexec/opkg-call';
const OPKG_FEEDS = '/etc/opkg/distfeeds.conf';
const APK_FEEDS = '/etc/apk/repositories.d/distfeeds.list';
const OPKG_LISTS = '/var/opkg-lists';
const APK_CACHE = '/var/cache/apk';
const APK_KEY_PATH = '/etc/apk/keys/routelink.pem';
/** 48 KB would exceed uhttpd's 64 KB request limit once base64-encoded. */
export const UPLOAD_CHUNK = 32 * 1024;

const call = (object: string, method: string, params?: Record<string, unknown>): UbusCall => ({
  object,
  method,
  params,
});
const data = <T>(r: UbusResult | undefined): T | undefined => (r?.ok ? (r.data as T) : undefined);
const installCommand = (helper: string, upload: string) => `${helper} install ${upload}`;

/** The checks run as one batch; nothing on the router changes. */
export async function detectPackageEnv(conn: RouterConnection): Promise<PackageEnvResult> {
  const accessFor = (helper: string, upload: string) =>
    call('session', 'access', { scope: 'file', object: installCommand(helper, upload), function: 'exec' });
  const r = await conn.batch([
    call('system', 'board'),
    call('system', 'info'),
    call('file', 'stat', { path: PACKAGE_MANAGER_CALL }),
    call('file', 'stat', { path: OPKG_CALL }),
    call('file', 'stat', { path: '/usr/bin/apk' }),
    call('file', 'read', { path: OPKG_FEEDS }),
    call('file', 'read', { path: APK_FEEDS }),
    call('file', 'list', { path: OPKG_LISTS }),
    call('file', 'list', { path: APK_CACHE }),
    accessFor(PACKAGE_MANAGER_CALL, '/tmp/upload.ipk'),
    accessFor(PACKAGE_MANAGER_CALL, '/tmp/upload.apk'),
    accessFor(OPKG_CALL, '/tmp/upload.ipk'),
  ]);
  const version = data<{ release?: { version?: string } }>(r[0])?.release?.version ?? '';
  if (!/^\d+\.\d+/.test(version)) return { unsupported: 'not-openwrt' };

  const helper = r[2].ok ? PACKAGE_MANAGER_CALL : r[3].ok ? OPKG_CALL : null;
  if (!helper) return { unsupported: 'no-helper' };
  const manager = r[4].ok ? 'apk' : 'opkg';
  const uploadPath = manager === 'apk' ? '/tmp/upload.apk' : '/tmp/upload.ipk';
  const access = helper === OPKG_CALL ? r[11] : manager === 'apk' ? r[10] : r[9];
  if (data<{ access?: boolean }>(access)?.access !== true) return { unsupported: 'no-permission' };

  const feeds = data<{ data?: string }>(manager === 'apk' ? r[6] : r[5])?.data ?? '';
  const arch = /\/packages\/([^/\s]+)\/base/.exec(feeds)?.[1] ?? '';
  const entries = data<{ entries?: { name: string }[] }>(manager === 'apk' ? r[8] : r[7])?.entries ?? [];
  const hasLists =
    manager === 'apk' ? entries.some((e) => e.name.endsWith('.adb')) : entries.some((e) => !e.name.endsWith('.sig'));
  return {
    release: version.split('.').slice(0, 2).join('.'),
    arch,
    manager,
    helper,
    uploadPath,
    updateArgs: helper === OPKG_CALL ? ['update', '-q'] : ['update'],
    freeKb: data<{ root?: { avail?: number } }>(r[1])?.root?.avail ?? 0,
    hasLists,
  };
}

/** Uploads through `file write` in base64 pieces; the first replaces the file, the rest append. */
export async function writeFileChunks(
  conn: RouterConnection,
  path: string,
  bytes: Uint8Array,
  chunk = UPLOAD_CHUNK,
  onProgress?: (sent: number) => void,
): Promise<void> {
  try {
    for (let offset = 0; offset < bytes.length || offset === 0; offset += chunk) {
      const piece = bytes.subarray(offset, offset + chunk);
      await conn.call('file', 'write', { path, data: bytesToBase64(piece), base64: true, append: offset > 0 });
      onProgress?.(Math.min(bytes.length, offset + chunk));
      if (bytes.length === 0) break;
    }
  } catch (error) {
    throw new PackageError('upload', error instanceof Error ? error.message : String(error));
  }
}

export interface HelperOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** The helpers print `{ code, stdout, stderr }` (jshn); anything else is passed on as text. */
export function parseHelperOutput(text: string): HelperOutput {
  try {
    const r = JSON.parse(text) as Partial<HelperOutput>;
    return {
      code: typeof r.code === 'number' ? r.code : -1,
      stdout: typeof r.stdout === 'string' ? r.stdout : '',
      stderr: typeof r.stderr === 'string' ? r.stderr : '',
    };
  } catch {
    return { code: -1, stdout: text, stderr: '' };
  }
}

/** Through cgi-exec: with ubus `file exec`, a package whose postinst reloads rpcd hangs the call for 60 s. */
async function runHelper(conn: RouterConnection, argv: string[]): Promise<HelperOutput> {
  if (!conn.cgiExec) throw new Error('this connection cannot run cgi-exec');
  return parseHelperOutput(await conn.cgiExec(argv));
}

const outputOf = (o: HelperOutput) => [o.stdout, o.stderr].filter(Boolean).join('\n');

export async function updateLists(conn: RouterConnection, env: PackageEnv): Promise<void> {
  const out = await runHelper(conn, [env.helper, ...env.updateArgs]);
  if (out.code !== 0) throw new PackageError('lists', outputOf(out));
}

/** Installs the file at `env.uploadPath`; dependencies come from the official feeds. */
export async function installUploaded(
  conn: RouterConnection,
  env: PackageEnv,
): Promise<{ ok: boolean; output: string }> {
  const out = await runHelper(conn, [env.helper, 'install', env.uploadPath]);
  return { ok: out.code === 0, output: outputOf(out) };
}

export async function removePackages(
  conn: RouterConnection,
  env: PackageEnv,
  names: string[],
): Promise<{ ok: boolean; output: string }> {
  const out = await runHelper(conn, [env.helper, 'remove', ...names]);
  return { ok: out.code === 0, output: outputOf(out) };
}

/** apk refuses unsigned local packages and the helper cannot pass --allow-untrusted: trust our key instead. */
export async function trustApkKey(conn: RouterConnection, pem: string): Promise<void> {
  await conn.call('file', 'write', { path: APK_KEY_PATH, data: pem });
}
