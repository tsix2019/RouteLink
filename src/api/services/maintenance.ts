import { isConnectivityError } from '../http/errors';
import type { RouterConnection } from '../connection/types';
import { ActionError } from './action-error';

/** MO-10: factory reset. `firstboot -r -y` wipes the overlay and reboots by itself (LuCI's command line). */

/** Where OpenWrt answers after a reset, without a password. */
export const DEFAULT_ADDRESS = 'http://192.168.1.1';

export async function factoryReset(conn: RouterConnection): Promise<void> {
  try {
    const r = await conn.call<{ code?: number; stderr?: string }>(
      'file',
      'exec',
      { command: '/sbin/firstboot', params: ['-r', '-y'] },
      { timeoutMs: 30_000 },
    );
    if (r.code !== undefined && r.code !== 0) throw new ActionError('reset-failed', r.stderr);
  } catch (error) {
    // The router may go down before it answers.
    if (!isConnectivityError(error)) throw error;
  }
}

/** Addresses to watch while a reset router comes back: where it was, and OpenWrt's default. */
export function resetAddresses(baseUrl: string): string[] {
  const plain = baseUrl.replace(/^https:/, 'http:');
  return [...new Set([plain, DEFAULT_ADDRESS])];
}
