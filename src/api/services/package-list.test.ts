import { FixtureConnection, loadFixture } from '../../../test/fixture-connection';
import { OPKG_CALL, PACKAGE_MANAGER_CALL, type PackageEnv } from './packages';
import {
  installPackages,
  listAvailable,
  listInstalled,
  parseApkJson,
  parseControl,
  removalCutsOffApp,
  searchPackages,
  type PackageInfo,
} from './package-list';

const recorded = (set: string, helper: string) =>
  (
    loadFixture(set, `file.exec.${helper.slice(1).replace(/\//g, '-')}-list-installed`) as {
      ok: true;
      data: { stdout: string };
    }
  ).data.stdout;

const AVAILABLE = `Package: adblock
Version: 4.2.2-r6
Depends: libc, jshn, jsonfilter, coreutils, coreutils-sort, curl
License: GPL-3.0-or-later
Section: net
Architecture: all
Installed-Size: 35840
Filename: adblock_4.2.2-r6_all.ipk
Size: 36561
Description:  Powerful adblock solution to block ads and trackers
 by DNS. Supports many blocklist sources.

Package: luci-app-adblock
Version: 24.10.123-abc
Depends: libc, adblock
Architecture: all
Installed-Size: 20480
Description:  LuCI support for Adblock

Package: block-mount
Version: 2024.11.11-r1
Depends: libc, ubox
Description:  Block device mounting and checking
`;

describe('parseControl', () => {
  it('reads opkg status and list files, multi-line descriptions included', () => {
    expect(parseControl(AVAILABLE)).toEqual([
      {
        name: 'adblock',
        version: '4.2.2-r6',
        description: 'Powerful adblock solution to block ads and trackers by DNS. Supports many blocklist sources.',
        size: 35840,
        depends: ['libc', 'jshn', 'jsonfilter', 'coreutils', 'coreutils-sort', 'curl'],
      },
      {
        name: 'luci-app-adblock',
        version: '24.10.123-abc',
        description: 'LuCI support for Adblock',
        size: 20480,
        depends: ['libc', 'adblock'],
      },
      {
        name: 'block-mount',
        version: '2024.11.11-r1',
        description: 'Block device mounting and checking',
        depends: ['libc', 'ubox'],
      },
    ]);
  });

  it('marks packages installed as dependencies (23.05 and 24.10 recordings)', () => {
    for (const [set, helper] of [
      ['openwrt-23.05.6', OPKG_CALL],
      ['openwrt-24.10.8', PACKAGE_MANAGER_CALL],
    ]) {
      const list = parseControl(recorded(set, helper));
      expect(list.length).toBeGreaterThan(100);
      expect(list.find((p) => p.name === 'luci-proto-wireguard')).toMatchObject({ auto: false });
      expect(list.find((p) => p.name === 'iwinfo')?.auto).toBe(true);
    }
  });
});

describe('parseApkJson', () => {
  it('reads apk’s JSON (25.12 recording)', () => {
    const list = parseApkJson(recorded('openwrt-25.12.5', PACKAGE_MANAGER_CALL));
    expect(list.length).toBe(222);
    expect(list.find((p) => p.name === 'apk-mbedtls')).toEqual({
      name: 'apk-mbedtls',
      version: '3.0.5-r3',
      description: 'apk package manager (mbedtls)',
      size: 232023,
      depends: ['libc', 'libmbedtls21', 'wget-any', 'zlib'],
    });
  });

  it('is empty for anything else', () => {
    expect(parseApkJson('nonsense')).toEqual([]);
    expect(parseApkJson('{"a":1}')).toEqual([]);
  });
});

describe('searchPackages', () => {
  const list: PackageInfo[] = parseControl(AVAILABLE);

  it('ranks exact names, then prefixes, then names, then descriptions', () => {
    expect(searchPackages(list, 'adblock').map((p) => p.name)).toEqual(['adblock', 'luci-app-adblock']);
    expect(searchPackages(list, 'BLOCK').map((p) => p.name)).toEqual(['block-mount', 'adblock', 'luci-app-adblock']);
    expect(searchPackages(list, 'mounting').map((p) => p.name)).toEqual(['block-mount']);
    expect(searchPackages(list, '  ')).toEqual(list);
  });
});

const env = (manager: 'opkg' | 'apk', helper: PackageEnv['helper'] = PACKAGE_MANAGER_CALL): PackageEnv => ({
  release: manager === 'apk' ? '25.12' : '24.10',
  arch: 'x86_64',
  manager,
  helper,
  uploadPath: manager === 'apk' ? '/tmp/upload.apk' : '/tmp/upload.ipk',
  updateArgs: ['update'],
  freeKb: 10_000,
  hasLists: true,
});

describe('listing through cgi-exec', () => {
  it('reads raw helper output for installed and available packages', async () => {
    const conn = new FixtureConnection('none').onCgiExec((argv) =>
      argv[1] === 'list-installed' ? recorded('openwrt-24.10.8', PACKAGE_MANAGER_CALL) : AVAILABLE,
    );
    expect((await listInstalled(conn, env('opkg'))).length).toBeGreaterThan(100);
    expect((await listAvailable(conn, env('opkg'))).map((p) => p.name)).toEqual([
      'adblock',
      'luci-app-adblock',
      'block-mount',
    ]);
    expect(conn.execs).toEqual([
      [PACKAGE_MANAGER_CALL, 'list-installed'],
      [PACKAGE_MANAGER_CALL, 'list-available'],
    ]);
  });

  it('parses apk JSON on 25.12', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() => recorded('openwrt-25.12.5', PACKAGE_MANAGER_CALL));
    expect(await listInstalled(conn, env('apk'))).toHaveLength(222);
  });

  it('installs by name and reports the helper’s output', async () => {
    const conn = new FixtureConnection('none').onCgiExec(() =>
      JSON.stringify({ code: 0, stdout: 'Installing adblock (4.2.2-r6) to root...' }),
    );
    expect(await installPackages(conn, env('opkg'), ['adblock', 'luci-app-adblock'])).toEqual({
      ok: true,
      output: 'Installing adblock (4.2.2-r6) to root...',
    });
    expect(conn.execs[0]).toEqual([PACKAGE_MANAGER_CALL, 'install', 'adblock', 'luci-app-adblock']);
    await expect(installPackages(conn, env('opkg'), ['bad name;'])).rejects.toThrow('invalid package name');
  });
});

describe('removalCutsOffApp', () => {
  it('names the packages the app needs', () => {
    expect(removalCutsOffApp(['adblock', 'uhttpd', 'rpcd'])).toEqual(['uhttpd', 'rpcd']);
    expect(removalCutsOffApp(['adblock'])).toEqual([]);
  });
});
