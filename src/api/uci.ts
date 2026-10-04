import type { RouterConnection } from './connection/types';
import { isConnectivityError } from './http/errors';
import { ProtocolError, UbusError } from './ubus/errors';
import type { UbusCall } from './ubus/types';

export type UciValues = Record<string, string | string[]>;

/** One uci section as returned by `uci get` (".name", ".type", ".anonymous", ".index" plus options). */
export type UciSection = Record<string, string | string[] | boolean | number | undefined> & {
  '.name': string;
  '.type': string;
};

/** set/add/delete return UbusCall objects so a whole change set can be staged in one batch. */
export const uci = {
  async get(conn: RouterConnection, config: string): Promise<Record<string, UciSection>> {
    const r = await conn.call<{ values?: Record<string, UciSection> }>('uci', 'get', { config });
    return r.values ?? {};
  },
  set: (config: string, section: string, values: UciValues): UbusCall => ({
    object: 'uci',
    method: 'set',
    params: { config, section, values },
  }),
  add: (config: string, type: string, values: UciValues, name?: string): UbusCall => ({
    object: 'uci',
    method: 'add',
    params: { config, type, values, ...(name ? { name } : {}) },
  }),
  del: (config: string, section: string): UbusCall => ({
    object: 'uci',
    method: 'delete',
    params: { config, section },
  }),
  delOption: (config: string, section: string, option: string): UbusCall => ({
    object: 'uci',
    method: 'delete',
    params: { config, section, option },
  }),
};

export type ApplyMode = 'rollback' | 'direct';

export type ApplyOutcome =
  | { status: 'confirmed' }
  /** Applied without a pending rollback (direct mode, or nothing was left to confirm). */
  | { status: 'applied' }
  | { status: 'rolled-back'; reason: 'confirm-timeout' };

export interface ApplyOptions {
  mode: ApplyMode;
  /** Router-side rollback timer; LuCI uses 90 s. */
  timeoutSec?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Stages `changes` and applies them (design §11).
 *
 * Verified rpcd behaviour (see the plan's execution log): only the applying session may confirm; on
 * timeout the router restores /etc/config and puts the changes back into the applying session's
 * staging area; and root may not `uci revert` over ubus (24.10 ACLs), so staging can't be cleaned
 * up afterwards.
 * Every change set is therefore staged in a session of its own (`conn.fork()`): a failed or
 * rolled-back set is abandoned with that session and never leaks into a later apply.
 */
export async function stageAndApply(
  conn: RouterConnection,
  changes: UbusCall[],
  o: ApplyOptions,
): Promise<ApplyOutcome> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = o.now ?? Date.now;
  const work = conn.fork?.() ?? conn;

  const staged = await work.batch(changes);
  const failed = staged.find((r) => !r.ok);
  if (failed && !failed.ok) throw failed.error;

  if (o.mode === 'direct') {
    await work.call('uci', 'apply', { rollback: false });
    return { status: 'applied' };
  }

  const timeoutSec = o.timeoutSec ?? 90;
  const deadline = now() + Math.max(5, timeoutSec - 10) * 1000;
  await work.call('uci', 'apply', { rollback: true, timeout: timeoutSec });
  await sleep(1_500);

  while (now() < deadline) {
    try {
      // Only the session that applied may confirm: never swap it for a fresh login here.
      await work.call('uci', 'confirm', {}, { timeoutMs: 4_000, relogin: false });
      return { status: 'confirmed' };
    } catch (error) {
      if (error instanceof UbusError && error.code === 'NO_DATA') return { status: 'applied' };
      const transient =
        isConnectivityError(error) ||
        error instanceof ProtocolError ||
        (error instanceof UbusError && error.code === 'ACCESS_DENIED');
      if (!transient) throw error;
      await sleep(2_000);
    }
  }
  return { status: 'rolled-back', reason: 'confirm-timeout' };
}
