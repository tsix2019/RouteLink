// M3 high-risk operations, run in full on the disposable QEMU router (design §21): VLAN changes with a
// rollback test, restoring a backup, a firmware upgrade through the online flow and a factory reset.
// They change the router for good, so CI runs this file last and on its own (npm run test:risky).
import { createHash } from 'node:crypto';

import { LiveConnection } from '../../src/api/connection/live';
import { nodeHttpClient } from '../../src/api/http/node';
import { backupContents, downloadBackup, restoreBackup, uploadBackup } from '../../src/api/services/backup';
import {
  checkOnline,
  flashFirmware,
  getFirmwareInfo,
  uploadFirmware,
  validateFirmware,
} from '../../src/api/services/firmware';
import { factoryReset } from '../../src/api/services/maintenance';
import { getSystem } from '../../src/api/services/system';
import {
  applyVlanChanges,
  disableFilteringChanges,
  enableFilteringChanges,
  getVlans,
  vlanChanges,
  type DsaVlans,
} from '../../src/api/services/vlan';
import { stageAndApply, uci } from '../../src/api/uci';
import { connect, ROUTER_URL, sleep, waitFor } from './router';

const dsa = async (conn: LiveConnection) => (await getVlans(conn)) as DsaVlans;

/** Down first (or a while passed), then answering again. */
async function waitForRestart(conn: LiveConnection, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  let sawDown = false;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const up = await conn.ping();
    if (!up) sawDown = true;
    else if (sawDown) return true;
  }
  return false;
}

const fetchJson = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
};

describe('M3 high risk: VLANs (with rollback)', () => {
  const { conn } = connect();

  it('switches VLAN filtering on, adds a tagged VLAN, survives a bad change by rolling back, and undoes it all', async () => {
    const start = await dsa(conn);
    expect(start).toMatchObject({ kind: 'dsa', bridge: 'br-lan', filtering: false });
    expect(start.ports.map((p) => p.id)).toEqual(['eth0', 'eth2', 'eth3']);

    expect((await applyVlanChanges(conn, enableFilteringChanges(start))).status).toBe('confirmed');
    const on = await dsa(conn);
    expect(on.filtering).toBe(true);
    expect(on.vlans.map((v) => [v.id, v.usedBy])).toEqual([[1, ['lan']]]);

    const withIot = [
      ...on.vlans,
      {
        id: 10,
        members: { eth2: { mode: 'tagged' as const, pvid: false }, eth3: { mode: 'tagged' as const, pvid: false } },
        usedBy: [],
      },
    ];
    expect((await applyVlanChanges(conn, vlanChanges(on, withIot))).status).toBe('confirmed');
    const two = await dsa(conn);
    expect(two.vlans.map((v) => v.id)).toEqual([1, 10]);

    // The port the app talks through leaves the LAN's VLAN: nothing can confirm, the router rolls back.
    const v1 = two.vlans[0];
    const cut = [{ ...v1, members: { ...v1.members, eth0: { mode: 'off' as const, pvid: false } } }, two.vlans[1]];
    const outcome = await applyVlanChanges(conn, vlanChanges(two, cut), { timeoutSec: 30 });
    expect(outcome.status).toBe('rolled-back');
    expect(
      await waitFor(async () => (await dsa(conn)).vlans[0]?.members.eth0?.mode === 'untagged', 120_000, 3_000),
    ).toBe(true);

    const back = await dsa(conn);
    expect((await applyVlanChanges(conn, vlanChanges(back, back.vlans.slice(0, 1)))).status).toBe('confirmed');
    expect((await applyVlanChanges(conn, disableFilteringChanges(await dsa(conn)))).status).toBe('confirmed');
    expect(await dsa(conn)).toMatchObject({ filtering: false, vlans: [], bridgeUsers: ['lan'] });
  }, 600_000);
});

describe('M3 high risk: restore a backup', () => {
  const { conn } = connect();

  it('restores the hostname a backup was taken with', async () => {
    const original = (await getSystem(conn)).hostname;
    const backup = await downloadBackup(conn);
    const system = Object.values(await uci.get(conn, 'system')).find((s) => s['.type'] === 'system')!;
    await stageAndApply(conn, [uci.set('system', system['.name'], { hostname: 'RouteLinkChanged' })], {
      mode: 'direct',
    });
    expect(await waitFor(async () => (await getSystem(conn)).hostname === 'RouteLinkChanged', 30_000)).toBe(true);

    await uploadBackup(conn, backup);
    expect(await backupContents(conn)).toContain('etc/config/system');
    await restoreBackup(conn);
    expect(await waitForRestart(conn, 240_000)).toBe(true);
    expect(await waitFor(async () => (await getSystem(conn)).hostname === original, 60_000, 3_000)).toBe(true);
  }, 420_000);
});

describe('M3 high risk: firmware upgrade', () => {
  const { conn } = connect();

  it('finds the official image online, verifies, uploads, validates and flashes it, keeping the settings', async () => {
    const info = await getFirmwareInfo(conn);
    const online = await checkOnline(info, fetchJson);
    if (online.status !== 'ok') throw new Error(`online check: ${online.status}`);
    // The same release again: an upgrade path the CI router can always take.
    const image = online.current;
    const bytes = new Uint8Array(await (await fetch(image.url)).arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
    await uploadFirmware(conn, bytes, info.tmpFreeKb);
    const check = await validateFirmware(conn);
    expect(check).toMatchObject({ valid: true, allowBackup: true, failed: [] });

    const marker = `rl-${Date.now() % 100000}`;
    const system = Object.values(await uci.get(conn, 'system')).find((s) => s['.type'] === 'system')!;
    await stageAndApply(conn, [uci.set('system', system['.name'], { hostname: marker })], { mode: 'direct' });

    await flashFirmware(conn, true, false);
    expect(await waitForRestart(conn, 480_000)).toBe(true);
    const after = await waitFor(async () => (await getSystem(conn)).hostname === marker, 120_000, 5_000);
    expect(after).toBe(true);
    expect((await getFirmwareInfo(conn)).version).toBe(info.version);
  }, 900_000);
});

describe('M3 high risk: factory reset', () => {
  const { conn } = connect();

  it('comes back with OpenWrt defaults and no password', async () => {
    await factoryReset(conn);
    expect(await waitForRestart(conn, 300_000)).toBe(true);
    // No password after a reset: the old one no longer applies, an empty one does.
    const fresh = new LiveConnection({
      routerId: 'reset',
      baseUrl: ROUTER_URL,
      username: 'root',
      password: '',
      http: nodeHttpClient,
    });
    expect(await waitFor(async () => (await getSystem(fresh)).hostname === 'OpenWrt', 120_000, 5_000)).toBe(true);
    expect(Object.values(await uci.get(fresh, 'network')).some((s) => s.proto === 'wireguard')).toBe(false);
  }, 600_000);
});
