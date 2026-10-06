import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';

/**
 * MO-12: the app's public key in dropbear's authorized_keys, written through the router login (LuCI's SSH keys
 * page does the same), so it works before any SSH connection exists.
 */

export const AUTHORIZED_KEYS = '/etc/dropbear/authorized_keys';

const KEY_TYPE = /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp\d+|sk-[\w@.-]+)$/;

/** "type blob" of an authorized_keys line, without options in front or the comment after; null if none. */
export function keyOf(line: string): string | null {
  const words = line.trim().split(/\s+/);
  if (!words[0] || words[0].startsWith('#')) return null;
  const i = words.findIndex((w) => KEY_TYPE.test(w));
  return i >= 0 && words[i + 1] ? `${words[i]} ${words[i + 1]}` : null;
}

const lines = (text: string) => text.split('\n').filter((l, i, all) => l !== '' || i < all.length - 1);

/** The file with the key added, or null when it is already there (under any comment). */
export function addKeyLine(text: string, line: string): string | null {
  const key = keyOf(line);
  if (!key) throw new Error('not an authorized_keys line');
  if (lines(text).some((l) => keyOf(l) === key)) return null;
  const body = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${body}${line.trim()}\n`;
}

/** The file without the key, or null when it was not there. */
export function removeKeyLine(text: string, line: string): string | null {
  const key = keyOf(line);
  const kept = lines(text).filter((l) => keyOf(l) !== key);
  if (kept.length === lines(text).length) return null;
  return kept.length ? `${kept.join('\n')}\n` : '';
}

async function readKeys(conn: RouterConnection): Promise<string> {
  try {
    return (await conn.call<{ data?: string }>('file', 'read', { path: AUTHORIZED_KEYS })).data ?? '';
  } catch (error) {
    // No file yet is an empty list; anything else (no permission) must not lead to a write.
    if (error instanceof UbusError && error.code === 'NOT_FOUND') return '';
    throw error;
  }
}

const writeKeys = (conn: RouterConnection, data: string) =>
  conn.call('file', 'write', { path: AUTHORIZED_KEYS, data, mode: 0o600 });

export async function hasPublicKey(conn: RouterConnection, line: string): Promise<boolean> {
  const key = keyOf(line);
  return lines(await readKeys(conn)).some((l) => keyOf(l) === key);
}

export async function installPublicKey(conn: RouterConnection, line: string): Promise<'installed' | 'present'> {
  const next = addKeyLine(await readKeys(conn), line);
  if (next === null) return 'present';
  await writeKeys(conn, next);
  return 'installed';
}

export async function removePublicKey(conn: RouterConnection, line: string): Promise<'removed' | 'absent'> {
  const next = removeKeyLine(await readKeys(conn), line);
  if (next === null) return 'absent';
  await writeKeys(conn, next);
  return 'removed';
}
