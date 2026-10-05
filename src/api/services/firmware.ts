import { isConnectivityError } from '../http/errors';
import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';
import { writeFileChunks } from './packages';

/**
 * MO-11: firmware upgrades. Images come from a local file or, for official OpenWrt and ImmortalWrt releases,
 * from the project's download site (profiles.json says which image fits the board). The phone downloads and
 * checks the image, uploads it to /tmp/firmware.bin, lets procd validate it, then runs sysupgrade with one of
 * the command lines in LuCI's ACL.
 */

export const FIRMWARE_PATH = '/tmp/firmware.bin';

const SITES: Record<string, string> = {
  OpenWrt: 'https://downloads.openwrt.org',
  ImmortalWrt: 'https://downloads.immortalwrt.org',
};

export interface FirmwareInfo {
  distribution: string;
  version: string;
  revision: string;
  /** "x86/64", "mediatek/filogic" … */
  target: string;
  board: string;
  model: string;
  rootfs: string;
  /** x86: booted through UEFI (the boot partition is the vfat ESP). */
  efi: boolean;
}

interface Board {
  model?: string;
  board_name?: string;
  rootfs_type?: string;
  release?: { distribution?: string; version?: string; revision?: string; target?: string };
}

export function firmwareInfoOf(board: Board, mounts: string): FirmwareInfo {
  return {
    distribution: board.release?.distribution ?? '',
    version: board.release?.version ?? '',
    revision: board.release?.revision ?? '',
    target: board.release?.target ?? '',
    board: board.board_name ?? '',
    model: board.model ?? '',
    rootfs: board.rootfs_type ?? '',
    efi: /\s\/boot\svfat\s/.test(mounts),
  };
}

export async function getFirmwareInfo(conn: RouterConnection): Promise<FirmwareInfo & { tmpFreeKb: number }> {
  const [board, mounts, info] = await conn.batch([
    { object: 'system', method: 'board' },
    { object: 'file', method: 'read', params: { path: '/proc/mounts' } },
    { object: 'system', method: 'info' },
  ]);
  if (!board.ok) throw board.error;
  const text = mounts.ok ? ((mounts.data as { data?: string }).data ?? '') : '';
  const tmp = info.ok ? (info.data as { tmp?: { avail?: number; free?: number } }).tmp : undefined;
  return { ...firmwareInfoOf(board.data as Board, text), tmpFreeKb: tmp?.avail ?? tmp?.free ?? 0 };
}

export type OnlineSupport = { ok: true; site: string } | { ok: false; reason: 'distribution' | 'version' };

/** Only final releases of the two projects that publish profiles.json. */
export function onlineSupport(info: FirmwareInfo): OnlineSupport {
  const site = SITES[info.distribution];
  if (!site) return { ok: false, reason: 'distribution' };
  if (!/^\d+\.\d+\.\d+$/.test(info.version)) return { ok: false, reason: 'version' };
  return { ok: true, site };
}

export interface VersionsJson {
  stable_version: string;
  oldstable_version?: string;
  versions_list: string[];
}

const parts = (v: string) => v.split('.').map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const series = (v: string) => v.split('.').slice(0, 2).join('.');

/** The newest release of the current series and the newest stable release, when newer. */
export function upgradeVersions(current: string, versions: VersionsJson): string[] {
  const finals = versions.versions_list.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const sameSeries = finals.filter((v) => series(v) === series(current)).sort((a, b) => (newer(a, b) ? -1 : 1))[0];
  const out: string[] = [];
  if (sameSeries && newer(sameSeries, current)) out.push(sameSeries);
  const stable = versions.stable_version;
  if (/^\d+\.\d+\.\d+$/.test(stable) && newer(stable, current) && !out.includes(stable)) out.push(stable);
  return out;
}

export interface ProfileImage {
  type: string;
  filesystem?: string;
  name: string;
  sha256: string;
}
export interface ProfilesJson {
  target: string;
  version_number: string;
  version_code: string;
  profiles: Record<string, { supported_devices: string[]; titles?: unknown[]; images: ProfileImage[] }>;
}

/** The image to flash: the board's sysupgrade image, or on x86/armsr the generic combined one for this boot method. */
export function pickImage(profiles: ProfilesJson, info: FirmwareInfo): ProfileImage | null {
  const profile =
    Object.values(profiles.profiles).find((p) => p.supported_devices.includes(info.board)) ??
    (/^(x86|armsr)\//.test(info.target) ? profiles.profiles.generic : undefined);
  if (!profile) return null;
  const sameFs = (i: ProfileImage) => !info.rootfs || !i.filesystem || i.filesystem === info.rootfs;
  const wanted = /^(x86|armsr)\//.test(info.target) ? (info.efi ? 'combined-efi' : 'combined') : 'sysupgrade';
  return (
    profile.images.find((i) => i.type === wanted && sameFs(i)) ?? profile.images.find((i) => i.type === wanted) ?? null
  );
}

export interface OfficialImage {
  version: string;
  name: string;
  url: string;
  /** Of the file as published (signed images included). */
  sha256: string;
}

type FetchJson = (url: string) => Promise<unknown>;

const profilesUrl = (site: string, version: string, target: string) =>
  `${site}/releases/${version}/targets/${target}/profiles.json`;

export async function findOfficialImage(
  info: FirmwareInfo,
  version: string,
  fetchJson: FetchJson,
  profiles?: ProfilesJson,
): Promise<OfficialImage | null> {
  const support = onlineSupport(info);
  if (!support.ok) return null;
  const p = profiles ?? ((await fetchJson(profilesUrl(support.site, version, info.target))) as ProfilesJson);
  const image = pickImage(p, info);
  if (!image) return null;
  return {
    version,
    name: image.name,
    url: `${support.site}/releases/${version}/targets/${info.target}/${image.name}`,
    sha256: image.sha256,
  };
}

export type OnlineCheck =
  | { status: 'unsupported'; reason: 'distribution' | 'version' }
  /** Called OpenWrt, but not the official build of that version. */
  | { status: 'custom-build' }
  | { status: 'no-image' }
  | { status: 'ok'; current: OfficialImage; upgrades: OfficialImage[] };

export async function checkOnline(info: FirmwareInfo, fetchJson: FetchJson): Promise<OnlineCheck> {
  const support = onlineSupport(info);
  if (!support.ok) return { status: 'unsupported', reason: support.reason };
  const versions = (await fetchJson(`${support.site}/.versions.json`)) as VersionsJson;
  let currentProfiles: ProfilesJson;
  try {
    currentProfiles = (await fetchJson(profilesUrl(support.site, info.version, info.target))) as ProfilesJson;
  } catch {
    return { status: 'no-image' };
  }
  if (currentProfiles.version_code && currentProfiles.version_code !== info.revision) return { status: 'custom-build' };
  const current = await findOfficialImage(info, info.version, fetchJson, currentProfiles);
  if (!current) return { status: 'no-image' };
  const upgrades: OfficialImage[] = [];
  for (const version of upgradeVersions(info.version, versions)) {
    const image = await findOfficialImage(info, version, fetchJson).catch(() => null);
    if (image) upgrades.push(image);
  }
  return { status: 'ok', current, upgrades };
}

/** /tmp is RAM: leave half a megabyte for everything else. */
export async function uploadFirmware(
  conn: RouterConnection,
  bytes: Uint8Array,
  tmpFreeKb: number,
  onProgress?: (sent: number) => void,
): Promise<void> {
  if (bytes.length + 512 * 1024 > tmpFreeKb * 1024) throw new ActionError('no-space');
  await writeFileChunks(conn, FIRMWARE_PATH, bytes, undefined, onProgress);
}

export interface FirmwareCheck {
  valid: boolean;
  /** Invalid, but sysupgrade --force would take it. */
  forceable: boolean;
  /** The settings can be kept with this image. */
  allowBackup: boolean;
  /** Names of the checks that failed. */
  failed: string[];
}

export async function validateFirmware(conn: RouterConnection): Promise<FirmwareCheck> {
  const r = await conn.call<{
    valid?: boolean;
    forceable?: boolean;
    allow_backup?: boolean;
    tests?: Record<string, boolean>;
  }>('system', 'validate_firmware_image', { path: FIRMWARE_PATH }, { timeoutMs: 60_000 });
  return {
    valid: !!r.valid,
    forceable: !!r.forceable,
    allowBackup: r.allow_backup !== false,
    failed: Object.entries(r.tests ?? {})
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  };
}

/** One of the command lines luci-mod-system's ACL allows. */
export function sysupgradeArgs(keepSettings: boolean, force: boolean): string[] {
  return [...(keepSettings ? [] : ['-n']), ...(force ? ['--force'] : []), FIRMWARE_PATH];
}

/** Starts the upgrade. sysupgrade stops rpcd on its way, so a missing answer means it is running. */
export async function flashFirmware(conn: RouterConnection, keepSettings: boolean, force: boolean): Promise<void> {
  try {
    const r = await conn.call<{ code?: number; stderr?: string }>(
      'file',
      'exec',
      { command: '/sbin/sysupgrade', params: sysupgradeArgs(keepSettings, force) },
      { timeoutMs: 20_000 },
    );
    if (r.code !== undefined && r.code !== 0) throw new ActionError('flash-failed', r.stderr);
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
  }
}
