// M3 services against a real router (QEMU in CI, with the M3 packages: DDNS, SQM, adblock-fast, adblock,
// OpenVPN). Everything changed here is put back. The steps that reach the internet (block lists) or need the
// runner's tools (openssl, an HTTP server the router can reach) run in CI only (EXPECT_RADIOS=1).
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { adblockAction, enableAdblock, getAdblock, type AdblockState } from '../../src/api/services/adblock';
import { backupFileList, downloadBackup, isGzip } from '../../src/api/services/backup';
import { ddnsChanges, deleteDdnsChanges, getDdns, saveDdns, validateDdns } from '../../src/api/services/ddns';
import { deleteInstance, getOpenvpn, importOvpn, setInstanceEnabled } from '../../src/api/services/openvpn';
import { flushCommand, getParental, saveSchedule } from '../../src/api/services/parental';
import { getSqm, queueChanges, saveSqm } from '../../src/api/services/sqm';
import { getSystem } from '../../src/api/services/system';
import { getRadios } from '../../src/api/services/wireless';
import {
  applyWgChanges,
  clientConfig,
  createInterfaceChanges,
  deleteInterfaceChanges,
  generateKeyPair,
  generatePsk,
  getWgConfig,
  nextPeerAddress,
  peerChanges,
  publicKeyOf,
  suggestInterface,
  validateWgInterface,
} from '../../src/api/services/wireguard-config';
import { getWifiSchedules, saveWifiSchedules } from '../../src/api/services/wifi-schedule';
import { stageAndApply, uci } from '../../src/api/uci';
import { connect, routerShell, SSH_PORT, waitFor } from './router';

const fast = { timeoutSec: 30 };
const strict = process.env.EXPECT_RADIOS === '1';

/** Names in a tar archive (ustar headers: name at 0, octal size at 124). */
function tarNames(tar: Uint8Array): string[] {
  const names: string[] = [];
  const text = (from: number, len: number) =>
    Buffer.from(tar.subarray(from, from + len))
      .toString('latin1')
      .replace(/\0.*$/s, '');
  for (let at = 0; at + 512 <= tar.length;) {
    const name = text(at, 100);
    if (!name) break;
    names.push(name.replace(/^\.\//, ''));
    at += 512 + Math.ceil(parseInt(text(at + 124, 12).trim() || '0', 8) / 512) * 512;
  }
  return names;
}

describe('M3: parental control', () => {
  const { conn } = connect();
  const MAC = 'AA:BB:CC:00:11:99';

  it('turns a school-night period into two fw4 time rules and a flush entry, then removes them', async () => {
    const periods = [{ days: [0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4)[], from: '21:00', to: '07:00' }];
    expect((await saveSchedule(conn, MAC, periods, true, fast)).status).toBe('confirmed');
    const state = await getParental(conn);
    expect(state.schedules.get(MAC)?.periods).toEqual(periods);
    expect(state.crontab.original).toContain(flushCommand(MAC));
    if (SSH_PORT) {
      const mine = routerShell('nft list ruleset')
        .split('\n')
        .filter((l) => l.includes('aa:bb:cc:00:11:99'));
      expect(mine).toHaveLength(2);
      expect(mine.every((l) => l.includes('meta hour') && l.includes('meta day'))).toBe(true);
      // What cron runs at the start of a period works on this kernel (nothing to flush here).
      routerShell(flushCommand(MAC));
    }
    await saveSchedule(conn, MAC, [], true, fast);
    const after = await getParental(conn);
    expect(after.schedules.has(MAC)).toBe(false);
    expect(after.crontab.original).not.toContain('aa:bb:cc:00:11:99');
  }, 120_000);
});

describe('M3: Wi-Fi schedule', () => {
  const { conn } = connect();

  it('switches a radio off and on again at the scheduled minutes', async () => {
    if (!strict) return; // needs radios and four minutes
    const radioUp = async () => (await getRadios(conn)).find((r) => r.name === 'radio0')?.up;
    expect(await radioUp()).toBe(true);
    const local = new Date((await getSystem(conn)).localTime * 1000);
    const at = (minutes: number) => {
      const d = new Date(local.getTime() + minutes * 60_000);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    };
    const before = await getWifiSchedules(conn);
    const schedule = { radios: ['radio0'], days: [0, 1, 2, 3, 4, 5, 6] as const, off: at(2), on: at(4) };
    try {
      await saveWifiSchedules(conn, [{ ...schedule, days: [...schedule.days] }], before.crontab);
      expect((await getWifiSchedules(conn)).schedules).toHaveLength(1);
      expect(await waitFor(async () => (await radioUp()) === false, 200_000, 5_000)).toBe(true);
      expect(await waitFor(async () => (await radioUp()) === true, 200_000, 5_000)).toBe(true);
    } finally {
      await saveWifiSchedules(conn, [], (await getWifiSchedules(conn)).crontab);
      if (SSH_PORT && (await radioUp()) === false) routerShell('wifi up radio0');
    }
  }, 600_000);
});

describe('M3: WireGuard settings', () => {
  const { conn } = connect();

  it('creates a tunnel with a peer, exports the peer and deletes the tunnel', async () => {
    const state = await getWgConfig(conn);
    if (!state.interfaces.length && !strict) return; // without luci-proto-wireguard
    const suggested = suggestInterface(state.interfaces, state.network);
    const keys = await generateKeyPair(conn);
    expect(await publicKeyOf(conn, keys.privateKey)).toBe(keys.publicKey);
    const input = { ...suggested, privateKey: keys.privateKey, mtu: '', joinLan: true, openPort: true };
    expect(validateWgInterface(input, state.interfaces, state.network)).toEqual({});
    expect((await applyWgChanges(conn, createInterfaceChanges(input, state.firewall), fast)).status).toBe('confirmed');

    let iface = (await getWgConfig(conn)).interfaces.find((i) => i.name === suggested.name)!;
    expect(iface).toMatchObject({ zone: 'lan', listenPort: suggested.listenPort });
    expect(iface.portRule).toBeDefined();
    const peerKeys = await generateKeyPair(conn);
    const peer = {
      name: 'Integration phone',
      publicKey: peerKeys.publicKey,
      privateKey: peerKeys.privateKey,
      presharedKey: await generatePsk(conn),
      allowedIps: nextPeerAddress(iface)!,
      endpointHost: '',
      endpointPort: '',
      keepalive: '25',
      routeAllowedIps: false,
    };
    expect((await applyWgChanges(conn, peerChanges(iface, peer), fast)).status).toBe('confirmed');
    const after = await getWgConfig(conn);
    iface = after.interfaces.find((i) => i.name === suggested.name)!;
    expect(iface.peers.map((p) => p.name)).toEqual(['Integration phone']);
    // The tunnel is up: wg shows it with the key the router derives from its private key.
    expect(await waitFor(async () => !!(await getWgConfig(conn)).publicKeys[suggested.name], 30_000)).toBe(true);
    const text = clientConfig(iface, iface.peers[0], {
      serverPublicKey: keys.publicKey,
      endpoint: '203.0.113.1',
      allowedIps: ['0.0.0.0/0'],
    });
    expect(text).toContain(`PrivateKey = ${peerKeys.privateKey}`);
    expect(text).toContain(`Endpoint = 203.0.113.1:${suggested.listenPort}`);

    expect((await applyWgChanges(conn, deleteInterfaceChanges(iface, after.firewall), fast)).status).toBe('confirmed');
    const gone = await getWgConfig(conn);
    expect(gone.interfaces.some((i) => i.name === suggested.name)).toBe(false);
    expect(Object.values(gone.firewall).some((s) => s.name === `RouteLink: WireGuard ${suggested.name}`)).toBe(false);
  }, 180_000);
});

describe('M3: OpenVPN', () => {
  const { conn } = connect();

  it('imports a client profile with a login, runs it, stops it and deletes it', async () => {
    if (!strict) return; // needs openssl on this machine for a CA certificate
    const ca = execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        '/dev/null',
        '-subj',
        '/CN=routelink-test-ca',
        '-days',
        '2',
      ],
      { encoding: 'utf8' },
    );
    // Nothing answers at 10.0.2.2:1194, so the client keeps trying: a running process to look at.
    const profile = [
      'client',
      'dev tun',
      'proto udp',
      'remote 10.0.2.2 1194',
      'nobind',
      'resolv-retry infinite',
      'auth-user-pass',
      'verb 3',
      '<ca>',
      ca.trim(),
      '</ca>',
      '',
    ].join('\n');
    expect((await importOvpn(conn, 'rltest', profile, { username: 'u', password: 'p' }, fast)).status).toBe(
      'confirmed',
    );
    const find = async () => (await getOpenvpn(conn)).instances.find((i) => i.name === 'rltest');
    const imported = (await find())!;
    expect(imported).toMatchObject({ enabled: true, hasLogin: true, configFile: '/etc/openvpn/rltest.ovpn' });
    if (imported.running !== null) {
      expect(await waitFor(async () => (await find())?.running === true, 30_000)).toBe(true);
    }
    await setInstanceEnabled(conn, imported, false, fast);
    expect(
      await waitFor(async () => (await find())?.enabled === false && (await find())?.running !== true, 30_000),
    ).toBe(true);
    await deleteInstance(conn, imported, fast);
    expect(await find()).toBeUndefined();
    if (SSH_PORT) expect(routerShell('ls /etc/openvpn')).not.toContain('rltest.ovpn');
  }, 180_000);
});

describe('M3: DDNS', () => {
  const { conn } = connect();

  it('sends an update to a custom URL, then the service is removed', async () => {
    if (!strict) return; // the router reaches this machine as 10.0.2.2 in QEMU only
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('good');
    });
    await new Promise<void>((resolve) => server.listen(18090, '0.0.0.0', resolve));
    // The QEMU WAN address is private; ddns-scripts skips those unless told otherwise.
    await stageAndApply(conn, [uci.set('ddns', 'global', { upd_privateip: '1' })], { mode: 'direct' });
    try {
      const state = await getDdns(conn);
      const input = {
        provider: '',
        updateUrl: 'http://10.0.2.2:18090/update?host=[DOMAIN]&ip=[IP]',
        domain: 'home.routelink.test',
        username: '',
        password: '',
        ipv6: false,
        source: 'wan' as const,
        enabled: true,
      };
      expect(validateDdns(input, null)).toEqual({});
      await saveDdns(conn, ddnsChanges(input, state.sections));
      expect(await waitFor(async () => hits.some((h) => h.includes('host=home.routelink.test')), 120_000, 2_000)).toBe(
        true,
      );
      expect(hits.find((h) => h.includes('host=home.routelink.test'))).toMatch(/ip=10\.0\.2\.\d+/);
      const service = (await getDdns(conn)).services.find((s) => s.domain === 'home.routelink.test')!;
      expect(service.status.running).toBe(true);
      await saveDdns(conn, deleteDdnsChanges(service));
      expect((await getDdns(conn)).services.some((s) => s.domain === 'home.routelink.test')).toBe(false);
    } finally {
      await stageAndApply(conn, [uci.set('ddns', 'global', { upd_privateip: '0' })], { mode: 'direct' });
      server.close();
    }
  }, 240_000);
});

describe('M3: SQM', () => {
  const { conn } = connect();

  it('shapes the WAN port and stops again', async () => {
    const state = await getSqm(conn);
    if (!state.installed) {
      if (strict) throw new Error('the QEMU setup installs sqm-scripts');
      return;
    }
    const queue = state.queues.find((q) => q.interface === 'eth1');
    const input = {
      enabled: true,
      interface: 'eth1',
      download: '50',
      upload: '10',
      script: 'piece_of_cake.qos',
      linklayer: 'ethernet' as const,
    };
    try {
      await saveSqm(conn, queueChanges(input, queue));
      expect(
        await waitFor(async () => !!(await getSqm(conn)).queues.find((q) => q.interface === 'eth1')?.active, 60_000),
      ).toBe(true);
    } finally {
      const current = (await getSqm(conn)).queues.find((q) => q.interface === 'eth1');
      await saveSqm(conn, queueChanges({ ...input, enabled: false }, current));
    }
    expect(
      await waitFor(async () => !(await getSqm(conn)).queues.find((q) => q.interface === 'eth1')?.active, 60_000),
    ).toBe(true);
  }, 180_000);
});

describe('M3: ad blocking', () => {
  const { conn } = connect();
  const state = async () => (await getAdblock(conn)) as AdblockState;

  it('adblock-fast: on with a small default list, blocking, then off', async () => {
    if (!strict) return; // downloads block lists
    const before = await state();
    expect(before).toMatchObject({ package: 'adblock-fast', enabled: false });
    try {
      await enableAdblock(conn, before);
      expect(await waitFor(async () => (await state()).status === 'running', 240_000, 5_000)).toBe(true);
      expect((await state()).blocked).toBeGreaterThan(1000);
    } finally {
      await adblockAction(conn, 'adblock-fast', 'off');
    }
    expect(await waitFor(async () => (await state()).status === 'stopped', 60_000, 3_000)).toBe(true);
  }, 400_000);

  it('adblock: on, blocking according to its runtime file, then off', async () => {
    if (!strict) return;
    try {
      await adblockAction(conn, 'adblock', 'on');
      const adblock = async () => {
        const s = await state();
        return s.package === 'adblock' ? s : null;
      };
      expect(await waitFor(async () => (await adblock())?.status === 'running', 300_000, 5_000)).toBe(true);
      expect((await adblock())!.blocked).toBeGreaterThan(1000);
    } finally {
      await adblockAction(conn, 'adblock', 'off');
    }
    // Off again, adblock-fast is the one the app shows.
    expect(await waitFor(async () => (await state()).package === 'adblock-fast', 60_000, 3_000)).toBe(true);
  }, 400_000);
});

describe('M3: backup download', () => {
  const { conn } = connect();

  it('downloads the configuration as a tar.gz with the config files in it', async () => {
    const bytes = await downloadBackup(conn);
    expect(isGzip(bytes)).toBe(true);
    const names = tarNames(gunzipSync(bytes));
    expect(names).toContain('etc/config/network');
    expect(await backupFileList(conn)).toContain('/etc/config/network');
  });
});
