// The package page (MO-5) against a real router: installed and available packages in each release's
// format, through LuCI's helper over cgi-exec.
import { listAvailable, listInstalled, searchPackages } from '../../src/api/services/package-list';
import { detectPackageEnv, updateLists, type PackageEnv } from '../../src/api/services/packages';
import { connect } from './router';

describe('packages', () => {
  const { conn } = connect();
  let env: PackageEnv;

  beforeAll(async () => {
    const detected = await detectPackageEnv(conn);
    if ('unsupported' in detected) throw new Error(`package manager: ${detected.unsupported}`);
    env = detected;
  });

  it('lists installed packages with versions', async () => {
    const installed = await listInstalled(conn, env);
    expect(installed.length).toBeGreaterThan(50);
    expect(installed.find((p) => p.name === 'rpcd')?.version).toMatch(/\d/);
    expect(installed.find((p) => p.name === 'luci-base')).toBeDefined();
  });

  it('updates the lists and searches the available packages', async () => {
    await updateLists(conn, env);
    const available = await listAvailable(conn, env);
    expect(available.length).toBeGreaterThan(1000);
    const hits = searchPackages(available, 'luci-app-');
    expect(hits.length).toBeGreaterThan(10);
    // Name matches come first; translations mention the app in their description.
    expect(hits.slice(0, 10).every((p) => p.name.includes('luci-app-'))).toBe(true);
  }, 180_000);
});
