import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import { OPKG_CALL, PMC, packageRouter as router } from '../../../test/package-router';
import {
  PackageError,
  detectPackageEnv,
  installUploaded,
  parseHelperOutput,
  removePackages,
  trustApkKey,
  updateLists,
  writeFileChunks,
  type PackageEnv,
} from './packages';

describe('detectPackageEnv', () => {
  it('reads OpenWrt 24.10: package-manager-call over opkg', async () => {
    await expect(detectPackageEnv(router())).resolves.toEqual({
      release: '24.10',
      arch: 'x86_64',
      manager: 'opkg',
      helper: PMC,
      uploadPath: '/tmp/upload.ipk',
      updateArgs: ['update'],
      freeKb: 77_557,
      hasLists: true,
    });
  });

  it('reads OpenWrt 23.05: opkg-call, whose ACL only allows "update" with an argument', async () => {
    await expect(
      detectPackageEnv(router({ release: '23.05.6', helper: OPKG_CALL, arch: 'mipsel_24kc' })),
    ).resolves.toMatchObject({
      release: '23.05',
      arch: 'mipsel_24kc',
      helper: OPKG_CALL,
      updateArgs: ['update', '-q'],
    });
  });

  it('reads OpenWrt 25.12: apk with its own feed list and upload path', async () => {
    await expect(
      detectPackageEnv(router({ release: '25.12.5', apk: true, arch: 'aarch64_cortex-a53' })),
    ).resolves.toMatchObject({
      release: '25.12',
      arch: 'aarch64_cortex-a53',
      manager: 'apk',
      uploadPath: '/tmp/upload.apk',
      updateArgs: ['update'],
      hasLists: true,
    });
  });

  it('notices missing package lists', async () => {
    await expect(detectPackageEnv(router({ lists: false }))).resolves.toMatchObject({ hasLists: false });
    await expect(detectPackageEnv(router({ apk: true, release: '25.12.5', lists: false }))).resolves.toMatchObject({
      hasLists: false,
    });
  });

  it('needs LuCI’s package manager page', async () => {
    await expect(detectPackageEnv(router({ helper: null }))).resolves.toEqual({ unsupported: 'no-helper' });
  });

  it('needs a release version', async () => {
    await expect(detectPackageEnv(router({ release: '' }))).resolves.toEqual({ unsupported: 'not-openwrt' });
  });

  it('reports missing permission when the account cannot even look for the helper', async () => {
    const conn = router().override('file.stat', fail('PERMISSION_DENIED'));
    for (const h of [PMC, OPKG_CALL])
      conn.override(`file.stat.${h.slice(1).replace(/[^a-zA-Z0-9]+/g, '-')}`, fail('PERMISSION_DENIED'));
    await expect(detectPackageEnv(conn)).resolves.toEqual({ unsupported: 'no-permission' });
  });

  it('needs permission to install (root)', async () => {
    await expect(detectPackageEnv(router({ access: false }))).resolves.toEqual({ unsupported: 'no-permission' });
  });

  it('asks about the exact command it will run', async () => {
    const conn = router();
    await detectPackageEnv(conn);
    const asked = conn.calls.filter((c) => c.object === 'session').map((c) => c.params?.object);
    expect(asked).toContain(`${PMC} install /tmp/upload.ipk`);
  });
});

const env: PackageEnv = {
  release: '24.10',
  arch: 'x86_64',
  manager: 'opkg',
  helper: PMC,
  uploadPath: '/tmp/upload.ipk',
  updateArgs: ['update'],
  freeKb: 77_557,
  hasLists: true,
};

describe('writeFileChunks', () => {
  it('writes 32 KB pieces: the first replaces the file, the rest append', async () => {
    const conn = new FixtureConnection('none').override('file.write', ok({}));
    const bytes = new Uint8Array(300 * 1024).map((_, i) => i & 0xff);
    const progress: number[] = [];
    await writeFileChunks(conn, '/tmp/upload.ipk', bytes, undefined, (sent) => progress.push(sent));
    const writes = conn.calls.filter((c) => c.method === 'write').map((c) => c.params as Record<string, unknown>);
    expect(writes).toHaveLength(10);
    expect(writes.map((w) => w.append)).toEqual([false, ...Array(9).fill(true)]);
    expect(writes.every((w) => w.base64 === true && w.path === '/tmp/upload.ipk')).toBe(true);
    const joined = Buffer.concat(writes.map((w) => Buffer.from(String(w.data), 'base64')));
    expect(joined.equals(Buffer.from(bytes))).toBe(true);
    expect(progress[progress.length - 1]).toBe(bytes.length);
  });

  it('fails with the upload reason', async () => {
    const conn = new FixtureConnection('none').override('file.write', fail('PERMISSION_DENIED'));
    await expect(writeFileChunks(conn, '/tmp/upload.ipk', new Uint8Array(10))).rejects.toMatchObject({
      reason: 'upload',
    });
  });
});

describe('helper commands', () => {
  const helperOut = (code: number, stdout = '', stderr = '') =>
    JSON.stringify({ code, pkmcmd: 'opkg', ...(stdout ? { stdout } : {}), ...(stderr ? { stderr } : {}) });

  it('parses the helper JSON, tolerating plain text', () => {
    expect(parseHelperOutput(helperOut(0, 'Installing'))).toEqual({ code: 0, stdout: 'Installing', stderr: '' });
    expect(parseHelperOutput('Usage: ...')).toEqual({ code: -1, stdout: 'Usage: ...', stderr: '' });
  });

  it('updates the lists through cgi-exec', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() => helperOut(0));
    await updateLists(conn, { ...env, helper: OPKG_CALL, updateArgs: ['update', '-q'] });
    expect(conn.execs).toEqual([[OPKG_CALL, 'update', '-q']]);
  });

  it('reports failed list updates', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() => helperOut(255, '', 'wget returned 4'));
    await expect(updateLists(conn, env)).rejects.toEqual(new PackageError('lists', 'wget returned 4'));
  });

  it('installs the uploaded file and returns the output', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() => helperOut(0, 'Installing routelinkd'));
    await expect(installUploaded(conn, env)).resolves.toEqual({ ok: true, output: 'Installing routelinkd' });
    expect(conn.execs).toEqual([[PMC, 'install', '/tmp/upload.ipk']]);
  });

  it('removes packages', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() => helperOut(1, '', 'busy'));
    await expect(removePackages(conn, env, ['luci-app-routelink', 'routelinkd'])).resolves.toEqual({
      ok: false,
      output: 'busy',
    });
    expect(conn.execs).toEqual([[PMC, 'remove', 'luci-app-routelink', 'routelinkd']]);
  });

  it('trusts the apk signing key by writing it to /etc/apk/keys', async () => {
    const conn = new FixtureConnection('none').override('file.write', ok({}));
    await trustApkKey(conn, '-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----\n');
    expect(conn.calls[0].params).toEqual({
      path: '/etc/apk/keys/routelink.pem',
      data: '-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----\n',
    });
  });
});
