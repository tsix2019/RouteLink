import { isAvailable, detectCapabilities } from '../../src/api/capabilities';
import {
  blockClient,
  removeStaticIp,
  renameClient,
  setStaticIp,
  unblockClient,
  wakeOnLan,
} from '../../src/api/services/client-actions';
import { getClients, type Client } from '../../src/api/services/clients';
import { getInterfaces } from '../../src/api/services/network';
import { connect } from './router';

// Short rollback timers keep the suite fast; the flow is the same as in the app.
const FAST = { timeoutSec: 20 };

describe('client actions', () => {
  const { conn } = connect();
  let target: Client | undefined;

  const reload = async () => (await getClients(conn)).find((c) => c.mac === target?.mac);

  beforeAll(async () => {
    // The host that talks to the router (Docker gateway, QEMU user-net host) is always a neighbour.
    target = (await getClients(conn)).find((c) => !!c.ipv4);
  });

  it('finds at least one client', () => {
    expect(target).toBeDefined();
  });

  it('renames a client, and the name shows up in the host hints', async () => {
    if (!target) return;
    const name = `rl-test-${Date.now() % 100000}`;
    await expect(renameClient(conn, target, name, FAST)).resolves.toMatchObject({ status: 'confirmed' });
    expect((await reload())?.name).toBe(name);
  }, 60_000);

  it('reserves and releases a static IP', async () => {
    const c = await reload();
    if (!c?.ipv4) return;
    await setStaticIp(conn, c, c.ipv4, await getClients(conn), FAST);
    const reserved = await reload();
    expect(reserved?.isStatic).toBe(true);
    await removeStaticIp(conn, reserved!, FAST);
    expect((await reload())?.isStatic).toBe(false);
  }, 90_000);

  it('blocks and unblocks a client', async () => {
    const c = await reload();
    if (!c) return;
    await blockClient(conn, c, FAST);
    const blocked = await reload();
    expect(blocked?.isBlocked).toBe(true);
    await unblockClient(conn, blocked!, FAST);
    expect((await reload())?.isBlocked).toBe(false);
  }, 90_000);

  it('sends a Wake-on-LAN packet from the router when etherwake is installed', async () => {
    const caps = await detectCapabilities(conn);
    if (!isAvailable(caps, 'clients.wol.router') || !target) return;
    const lan = (await getInterfaces(conn)).find((i) => i.name === 'lan')?.device;
    const board = await conn.call<{ release?: { version?: string } }>('system', 'board');
    const sent = wakeOnLan(conn, target.mac, { routerSide: true, lanDevice: lan });
    if (board.release?.version === '25.12.5') {
      // LuCI's luci.wol helper fails on 25.12.5 (an upstream bug); the app falls back to the phone.
      await expect(sent).rejects.toMatchObject({ code: 'wol-failed' });
    } else {
      await expect(sent).resolves.toBe('router');
    }
  });
});
