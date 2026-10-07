import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PackageEnv } from '@/api/services/packages';

import { ROUTELINK_APK_PEM } from './keys';
import { ManifestError, applyMirror, parseManifest, pickTarget } from './manifest';

const file = (pkg: string, release = '24.10', arch = 'x86_64') => ({
  package: pkg,
  name: `${pkg}_0.1.0-r1_${release}_${arch}.ipk`,
  url: `https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0/${pkg}_0.1.0-r1_${release}_${arch}.ipk`,
  sha256: 'ab'.repeat(32),
  size: 12_345,
});

const raw = {
  version: '0.1.0',
  api: 1,
  tag: 'agent-v0.1.0',
  released: '2026-10-05T00:00:00.000Z',
  prerelease: false,
  targets: {
    '24.10/x86_64': {
      format: 'ipk',
      files: [file('luci-i18n-routelink-zh-cn'), file('routelinkd'), file('luci-app-routelink')],
    },
    '25.12/x86_64': {
      format: 'apk',
      files: [{ ...file('routelinkd', '25.12'), name: 'routelinkd-0.1.0-r1_25.12_x86_64.apk' }],
    },
    '25.12/x86_64/ipk': {
      format: 'ipk',
      files: [file('routelinkd', '25.12')],
    },
  },
};

const env = (release: string, arch: string, manager: 'opkg' | 'apk' = 'opkg'): PackageEnv => ({
  release,
  arch,
  manager,
  helper: '/usr/libexec/package-manager-call',
  uploadPath: manager === 'apk' ? '/tmp/upload.apk' : '/tmp/upload.ipk',
  updateArgs: ['update'],
  freeKb: 1_000_000,
  hasLists: true,
});

describe('parseManifest', () => {
  it('reads what scripts/agent-manifest.ts writes', () => {
    const m = parseManifest(raw);
    expect(m.version).toBe('0.1.0');
    expect(Object.keys(m.targets)).toEqual(['24.10/x86_64', '25.12/x86_64', '25.12/x86_64/ipk']);
  });

  it('rejects anything that is not a manifest', () => {
    expect(() => parseManifest('<html>')).toThrow(ManifestError);
    expect(() => parseManifest({ version: '1', targets: {} })).toThrow(ManifestError);
    expect(() =>
      parseManifest({ ...raw, targets: { '24.10/x86_64': { format: 'ipk', files: [{ package: 'routelinkd' }] } } }),
    ).toThrow(ManifestError);
  });
});

describe('pickTarget', () => {
  const m = parseManifest(raw);

  it('returns the packages in install order: daemon, LuCI app, translation', () => {
    const files = pickTarget(m, env('24.10', 'x86_64'));
    expect(Array.isArray(files) && files.map((f) => f.package)).toEqual([
      'routelinkd',
      'luci-app-routelink',
      'luci-i18n-routelink-zh-cn',
    ]);
  });

  it('tells an unknown architecture from an unknown release', () => {
    expect(pickTarget(m, env('24.10', 'mips_24kc'))).toBe('unsupported-arch');
    expect(pickTarget(m, env('22.03', 'x86_64'))).toBe('unsupported-release');
  });

  it('picks by the router’s package manager, not by what its release usually has', () => {
    const names = (r: ReturnType<typeof pickTarget>) => (Array.isArray(r) ? r.map((f) => f.name) : r);
    expect(names(pickTarget(m, env('25.12', 'x86_64', 'apk')))).toEqual(['routelinkd-0.1.0-r1_25.12_x86_64.apk']);
    // Kwrt 25.12 kept opkg
    expect(names(pickTarget(m, env('25.12', 'x86_64', 'opkg')))).toEqual(['routelinkd_0.1.0-r1_25.12_x86_64.ipk']);
    expect(pickTarget(m, env('25.12', 'mips_24kc', 'opkg'))).toBe('unsupported-arch');
    expect(pickTarget(m, env('24.10', 'x86_64', 'apk'))).toBe('unsupported-release');
  });

  it('finds nothing for opkg on 25.12 in a manifest from before 25.12 had ipk packages', () => {
    const { '25.12/x86_64/ipk': _ipk, ...targets } = raw.targets;
    expect(pickTarget(parseManifest({ ...raw, targets }), env('25.12', 'x86_64', 'opkg'))).toBe('unsupported-release');
  });
});

describe('applyMirror', () => {
  const url = 'https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0/x.ipk';

  it('puts the mirror in front of the URL', () => {
    expect(applyMirror(url, 'https://ghproxy.example')).toBe(`https://ghproxy.example/${url}`);
    expect(applyMirror(url, 'https://ghproxy.example/')).toBe(`https://ghproxy.example/${url}`);
  });

  it('leaves the URL alone without a (valid) mirror', () => {
    expect(applyMirror(url)).toBe(url);
    expect(applyMirror(url, '  ')).toBe(url);
    expect(applyMirror(url, 'ftp://nope')).toBe(url);
  });
});

describe('ROUTELINK_APK_PEM', () => {
  it('is the public key the feed is signed with', () => {
    const pem = readFileSync(join(__dirname, '../../../openwrt/feed/keys/routelink-apk.pem'), 'utf8');
    expect(ROUTELINK_APK_PEM).toBe(pem.replace(/\r\n/g, '\n'));
  });
});
