// The domain services against responses recorded from real OpenWrt releases (QEMU in CI, see
// .github/workflows/integration.yml): 23.05.6, 24.10.8 and 25.12.5, each with three hwsim radios.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { FixtureConnection } from '../../../test/fixture-connection';
import { detectCapabilities } from '../capabilities';
import { getClients } from './clients';
import { systemLog } from './logs';
import { getDeviceCounters, getInterfaces, pickWan } from './network';
import { detectPackageEnv } from './packages';
import { listServices } from './services';
import { getSystem } from './system';
import { getRadioCapabilities, getRadios, scan } from './wireless';

const VERSIONS = ['23.05.6', '24.10.8', '25.12.5'].filter((v) =>
  existsSync(join(__dirname, '../../../test/fixtures', `openwrt-${v}`)),
);

describe.each(VERSIONS)('OpenWrt %s', (version) => {
  const conn = () => new FixtureConnection(`openwrt-${version}`);

  it('reads the system', async () => {
    const s = await getSystem(conn());
    expect(s.version).toBe(version);
    expect(s.memory.total).toBeGreaterThan(0);
    expect(s.cpuCores).toBeGreaterThanOrEqual(1);
  });

  it('reads interfaces and counters', async () => {
    const ifs = await getInterfaces(conn());
    const lan = ifs.find((i) => i.name === 'lan');
    expect(lan?.up).toBe(true);
    expect(lan?.ipv4[0]?.address).toBe('192.168.1.1');
    expect(pickWan(ifs)?.up).toBe(true);
    const counters = await getDeviceCounters(conn());
    expect(counters[lan!.device!]).toBeDefined();
  });

  it('reads three radios with their networks', async () => {
    const radios = await getRadios(conn());
    expect(radios.map((r) => [r.name, r.band])).toEqual([
      ['radio0', '2.4G'],
      ['radio1', '5G'],
      ['radio2', '2.4G'],
    ]);
    expect(radios.map((r) => r.networks[0]?.ssid)).toEqual(['RouteLink', 'RouteLink-5G', 'Neighbor-Test']);
    expect(radios.every((r) => r.up)).toBe(true);
    const caps = await getRadioCapabilities(conn(), 'radio0');
    expect(caps.channels.map((c) => c.channel)).toContain(6);
    expect(caps.htmodes).toContain('HT20');
    expect(caps.txpowers.length).toBeGreaterThan(0);
  });

  it('finds the neighbour network in a scan from radio0', async () => {
    const radios = await getRadios(conn());
    const ifname = radios[0].networks[0].ifname;
    if (!ifname) return; // recorded without a running AP interface
    expect((await scan(conn(), ifname)).map((n) => n.ssid)).toContain('Neighbor-Test');
  });

  it('lists clients without failing', async () => {
    await expect(getClients(conn())).resolves.toEqual(expect.any(Array));
  });

  it('lists services and reads the system log', async () => {
    const services = await listServices(conn());
    const dropbear = services.find((s) => s.name === 'dropbear');
    expect(dropbear?.enabled).toBe(true);
    // 23.05 lists init scripts through LuCI, which doesn't report whether they run.
    expect(dropbear?.running).toBe(version.startsWith('23.') ? undefined : true);
    expect((await systemLog(conn())).length).toBeGreaterThan(10);
  });

  it("finds LuCI's package helper for the plugin install", async () => {
    const env = await detectPackageEnv(conn());
    const pmc = '/usr/libexec/package-manager-call';
    expect(env).toMatchObject(
      version.startsWith('23.')
        ? {
            helper: '/usr/libexec/opkg-call',
            manager: 'opkg',
            uploadPath: '/tmp/upload.ipk',
            updateArgs: ['update', '-q'],
          }
        : version.startsWith('25.')
          ? { helper: pmc, manager: 'apk', uploadPath: '/tmp/upload.apk', updateArgs: ['update'] }
          : { helper: pmc, manager: 'opkg', uploadPath: '/tmp/upload.ipk', updateArgs: ['update'] },
    );
    // Recorded after a reboot: the package lists live in RAM and are gone.
    expect(env).toMatchObject({ release: version.split('.').slice(0, 2).join('.'), arch: 'x86_64', hasLists: false });
    expect('freeKb' in env && env.freeKb).toBeGreaterThan(1000);
  });

  it('detects services and logs as available', async () => {
    const caps = await detectCapabilities(conn());
    expect(caps.services).toEqual({ status: 'ok' });
    expect(caps['logs.system']).toEqual({ status: 'ok' });
    expect(caps.wireless).toEqual({ status: 'ok' });
    expect(caps['clients.wol.router']).toEqual({ status: 'ok' });
  });
});
