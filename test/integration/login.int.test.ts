import { classifyError } from '../../src/api/connection/types';
import { stageAndApply, uci } from '../../src/api/uci';
import { connect, ROUTER_URL, sleep, waitFor } from './router';

describe('login', () => {
  it('logs in over ubus and reads the board', async () => {
    const { conn, sessions } = connect();
    const board = await conn.call<{ release?: { distribution?: string } }>('system', 'board');
    expect(board.release?.distribution).toMatch(/openwrt|immortalwrt/i);
    expect(sessions[0]?.mode).toBe('ubus');
  });

  it('reports a wrong password as an authentication failure', async () => {
    const { conn } = connect({ password: 'definitely-not-the-password' });
    const error = await conn.call('system', 'board').catch((e: unknown) => e);
    expect(classifyError(error)).toEqual({ kind: 'auth' });
  });

  it('logs in again by itself after its session is gone', async () => {
    const { conn, sessions } = connect();
    await conn.call('system', 'board');
    // root may not destroy sessions over ubus; restarting rpcd drops them all.
    await conn.call('rc', 'init', { name: 'rpcd', action: 'restart' }).catch(() => undefined);
    await sleep(3_000);
    expect(await waitFor(async () => !!(await conn.call('system', 'board')), 30_000)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.at(-1)?.sid).not.toBe(sessions[0].sid);
  }, 60_000);

  it('falls back to the LuCI login when uhttpd has no /ubus endpoint', async () => {
    const admin = connect().conn;
    const prefix = await admin.call<{ value?: string }>('uci', 'get', {
      config: 'uhttpd',
      section: 'main',
      option: 'ubus_prefix',
    });
    expect(prefix.value).toBe('/ubus');

    // Without the prefix uhttpd stops serving /ubus; LuCI's own endpoint keeps working.
    await stageAndApply(admin, [uci.delOption('uhttpd', 'main', 'ubus_prefix')], { mode: 'direct' });
    // uhttpd reloads a moment after the apply; wait until /ubus is really gone.
    const ubusGone = async () => {
      const res = await fetch(`${ROUTER_URL}/ubus`, { method: 'POST', body: '{}' }).catch(() => null);
      return res?.status === 404;
    };
    expect(await waitFor(ubusGone, 30_000)).toBe(true);
    try {
      const luci = connect();
      expect(await waitFor(async () => !!(await luci.conn.call('system', 'board')), 30_000)).toBe(true);
      expect(luci.sessions.at(-1)?.mode).toBe('luci');
    } finally {
      // Restore through LuCI's endpoint: /ubus is back only after uhttpd reloads.
      await waitFor(async () => {
        const restore = connect({ authMode: 'luci' }).conn;
        await stageAndApply(restore, [uci.set('uhttpd', 'main', { ubus_prefix: '/ubus' })], { mode: 'direct' });
        return true;
      }, 30_000);
      expect(await waitFor(async () => (await connect().conn.call('system', 'board')) !== undefined, 30_000)).toBe(
        true,
      );
    }
  }, 120_000);
});
