import { artifactDir, buildManifest, parseArtifactDir, parsePackageFile, releaseKey } from './agent-manifest';

describe('parsePackageFile', () => {
  it('reads ipk names (23.05 and 24.10 styles)', () => {
    expect(parsePackageFile('routelinkd_0.1.0-r1_x86_64.ipk')).toEqual({
      package: 'routelinkd',
      version: '0.1.0-r1',
      format: 'ipk',
    });
    expect(parsePackageFile('routelinkd_0.1.0-1_mipsel_24kc.ipk')?.version).toBe('0.1.0-1');
    expect(parsePackageFile('luci-app-routelink_0.1.0_all.ipk')?.package).toBe('luci-app-routelink');
    expect(parsePackageFile('luci-i18n-routelink-zh-cn_0.1.0-r1_all.ipk')?.package).toBe('luci-i18n-routelink-zh-cn');
  });

  it('reads apk names', () => {
    expect(parsePackageFile('luci-i18n-routelink-zh-cn-0.1.0-r1.apk')).toEqual({
      package: 'luci-i18n-routelink-zh-cn',
      version: '0.1.0-r1',
      format: 'apk',
    });
    expect(parsePackageFile('routelinkd-0.1.0-r1.apk')?.package).toBe('routelinkd');
  });

  it('ignores index files and unknown packages', () => {
    expect(parsePackageFile('Packages.gz')).toBeNull();
    expect(parsePackageFile('packages.adb')).toBeNull();
    expect(parsePackageFile('libubox_2024_x86_64.ipk')).toBeNull();
  });
});

describe('releaseKey', () => {
  it('keeps major.minor', () => {
    expect(releaseKey('24.10.8')).toBe('24.10');
    expect(releaseKey('25.12.5')).toBe('25.12');
  });
});

describe('parseArtifactDir', () => {
  it('reads release, arch and a forced format', () => {
    expect(parseArtifactDir('pkg-24.10.8-x86_64')).toEqual({ release: '24.10.8', arch: 'x86_64' });
    expect(parseArtifactDir('pkg-25.12.5-arm_cortex-a7_neon-vfpv4-ipk')).toEqual({
      release: '25.12.5',
      arch: 'arm_cortex-a7_neon-vfpv4',
      format: 'ipk',
    });
    expect(parseArtifactDir('pkg-25.12.5-arm_cortex-a7_neon-vfpv4')?.arch).toBe('arm_cortex-a7_neon-vfpv4');
    expect(parseArtifactDir('logs')).toBeNull();
  });

  it('round-trips with artifactDir', () => {
    for (const name of ['pkg-23.05.6-mips_24kc', 'pkg-25.12.5-aarch64_cortex-a53-ipk']) {
      expect(artifactDir(parseArtifactDir(name)!)).toBe(name);
    }
  });
});

describe('buildManifest', () => {
  const m = buildManifest({
    version: '0.1.0',
    api: 1,
    tag: 'agent-v0.1.0',
    released: '2026-10-05T00:00:00Z',
    downloadBase: 'https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0',
    targets: [
      {
        release: '24.10.8',
        arch: 'x86_64',
        files: [
          { name: 'luci-app-routelink_0.1.0-r1_all.ipk', sha256: 'b', size: 20 },
          { name: 'routelinkd_0.1.0-r1_x86_64.ipk', sha256: 'a', size: 10 },
          { name: 'Packages.gz', sha256: 'x', size: 1 },
        ],
      },
      {
        release: '25.12.5',
        arch: 'mipsel_24kc',
        files: [{ name: 'routelinkd-0.1.0-r1.apk', sha256: 'c', size: 30 }],
      },
      {
        release: '25.12.5',
        arch: 'mipsel_24kc',
        format: 'ipk',
        files: [{ name: 'routelinkd_0.1.0-r1_mipsel_24kc.ipk', sha256: 'd', size: 40 }],
      },
    ],
  });

  it('lists packages per release/arch in install order with unique asset names', () => {
    const t = m.manifest.targets['24.10/x86_64'];
    expect(t.format).toBe('ipk');
    expect(t.files.map((f) => f.package)).toEqual(['routelinkd', 'luci-app-routelink']);
    expect(t.files[0]).toEqual({
      package: 'routelinkd',
      name: 'routelinkd_0.1.0-r1_24.10_x86_64.ipk',
      url: 'https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0/routelinkd_0.1.0-r1_24.10_x86_64.ipk',
      sha256: 'a',
      size: 10,
    });
    expect(m.manifest.targets['25.12/mipsel_24kc'].files[0].name).toBe('routelinkd-0.1.0-r1_25.12_mipsel_24kc.apk');
  });

  it('keys the format a release does not use itself by format too', () => {
    expect(m.manifest.targets['25.12/mipsel_24kc'].format).toBe('apk');
    const ipk = m.manifest.targets['25.12/mipsel_24kc/ipk'];
    expect(ipk.format).toBe('ipk');
    expect(ipk.files.map((f) => f.name)).toEqual(['routelinkd_0.1.0-r1_25.12_mipsel_24kc.ipk']);
  });

  it('maps every asset back to its original file', () => {
    expect(m.assets).toContainEqual({
      from: 'pkg-24.10.8-x86_64/routelinkd_0.1.0-r1_x86_64.ipk',
      to: 'routelinkd_0.1.0-r1_24.10_x86_64.ipk',
    });
    expect(m.assets).toContainEqual({
      from: 'pkg-25.12.5-mipsel_24kc-ipk/routelinkd_0.1.0-r1_mipsel_24kc.ipk',
      to: 'routelinkd_0.1.0-r1_25.12_mipsel_24kc.ipk',
    });
    expect(m.assets).toHaveLength(4);
  });

  it('marks pre-releases', () => {
    const pre = buildManifest({ version: '0.1.0', api: 1, tag: 'agent-v0.1.0-rc.1', released: '', downloadBase: '', targets: [] });
    expect(pre.manifest.prerelease).toBe(true);
    expect(m.manifest.prerelease).toBe(false);
  });
});
