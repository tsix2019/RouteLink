import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';
import { writeFileChunks } from './packages';
import { reboot } from './system';

/**
 * MO-9: configuration backups. Downloading uses LuCI's cgi-backup; restoring uploads to the one path LuCI's ACL
 * allows, checks the archive with tar and hands it to `sysupgrade --restore-backup`, then reboots. The command
 * lines are exactly the ones in luci-mod-system's ACL.
 */

export const BACKUP_PATH = '/tmp/backup.tar.gz';

type Exec = { code?: number; stdout?: string; stderr?: string };

const exec = (conn: RouterConnection, command: string, params: string[], timeoutMs = 30_000) =>
  conn.call<Exec>('file', 'exec', { command, params }, { timeoutMs });

export const isGzip = (bytes: Uint8Array) => bytes.length > 18 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** LuCI's name for it: backup-<hostname>-<YYYY-MM-DD>.tar.gz. */
export function backupFileName(hostname: string, date: Date): string {
  const host = hostname.replace(/[^A-Za-z0-9._-]+/g, '_') || 'OpenWrt';
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0'));
  return `backup-${host}-${day.join('-')}.tar.gz`;
}

export async function downloadBackup(conn: RouterConnection): Promise<Uint8Array> {
  if (!conn.downloadBackup) throw new ActionError('backup-unsupported');
  const bytes = await conn.downloadBackup();
  if (!isGzip(bytes)) throw new ActionError('backup-invalid');
  return bytes;
}

/** What a backup would hold: the changed config files and the ones listed in /etc/sysupgrade.conf. */
export async function backupFileList(conn: RouterConnection): Promise<string[]> {
  const r = await exec(conn, '/sbin/sysupgrade', ['--list-backup']);
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

export async function uploadBackup(
  conn: RouterConnection,
  bytes: Uint8Array,
  onProgress?: (sent: number) => void,
): Promise<void> {
  if (!isGzip(bytes)) throw new ActionError('backup-invalid');
  await writeFileChunks(conn, BACKUP_PATH, bytes, undefined, onProgress);
}

/** Files in the uploaded archive; refuses anything that is not a configuration backup. */
export async function backupContents(conn: RouterConnection): Promise<string[]> {
  const r = await exec(conn, '/bin/tar', ['-tzf', BACKUP_PATH]);
  const files = (r.stdout ?? '')
    .split('\n')
    .map((f) => f.replace(/^\.?\//, ''))
    .filter(Boolean);
  if (r.code !== 0 || !files.some((f) => f.startsWith('etc/config/'))) {
    throw new ActionError('backup-invalid', r.stderr);
  }
  return files.filter((f) => !f.endsWith('/'));
}

/** Restores the uploaded archive and reboots; the router comes back with the backup's settings. */
export async function restoreBackup(conn: RouterConnection): Promise<void> {
  const r = await exec(conn, '/sbin/sysupgrade', ['--restore-backup', BACKUP_PATH], 60_000);
  if (r.code !== 0) throw new ActionError('restore-failed', r.stderr);
  await reboot(conn);
}
