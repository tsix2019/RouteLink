import { createHash } from 'node:crypto';

import { fail, ok } from '../../../test/fixture-connection';
import { OPKG_CALL, packageRouter, type RouterSetup } from '../../../test/package-router';
import { installAgent, type InstallDeps, type InstallStep } from './install';
import { MANIFEST_URL } from './manifest';

const PACKAGES = ['routelinkd', 'luci-app-routelink', 'luci-i18n-routelink-zh-cn'];
const bytesOf = (pkg: string) => new Uint8Array(40_000 + pkg.length).fill(pkg.length);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function manifest(release = '24.10', arch = 'x86_64', format: 'ipk' | 'apk' = 'ipk') {
  return {
    version: '0.1.0',
    api: 1,
    targets: {
      [`${release}/${arch}`]: {
        format,
        files: PACKAGES.map((p) => ({
          package: p,
          name: `${p}.${format}`,
          url: `https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0/${p}.${format}`,
          sha256: sha(bytesOf(p)),
          size: bytesOf(p).length,
        })),
      },
    },
  };
}

const helperOut = (code: number, stdout = '', stderr = '') => JSON.stringify({ code, stdout, stderr });

interface Setup extends RouterSetup {
  /** Helper result for `install`; default success. */
  install?: (argv: string[]) => string;
  update?: string;
  /** How many status checks fail before the plugin answers. */
  slowStart?: number;
  neverStarts?: boolean;
  manifestJson?: unknown;
  downloadFails?: boolean;
  corrupt?: string;
  writeFails?: boolean;
}

function harness(o: Setup = {}) {
  const release = o.release ?? '24.10.8';
  const apk = o.apk ?? false;
  const conn = packageRouter(o);
  let installed = false;
  let checks = 0;
  conn.override('file.write', o.writeFails ? fail('PERMISSION_DENIED') : ok({}));
  conn.override('routelink.info', () => {
    checks += 1;
    if (!installed || o.neverStarts || checks <= (o.slowStart ?? 0)) return fail(installed ? 'NOT_FOUND' : 'PERMISSION_DENIED');
    return ok({ version: '0.1.0', api: 1 });
  });
  conn.override('file.stat.usr-sbin-routelinkd', () => (installed ? ok({ type: 'file' }) : fail('NOT_FOUND')));
  conn.onCgiExec((argv) => {
    if (argv[1] === 'update') return o.update ?? helperOut(0);
    const out = o.install ? o.install(argv) : helperOut(0, 'Installing');
    if (JSON.parse(out).code === 0) installed = true;
    return out;
  });
  const steps: InstallStep[] = [];
  const downloads: string[] = [];
  const manifests: string[] = [];
  const deps: InstallDeps = {
    conn,
    fetchManifest: async (url) => {
      manifests.push(url);
      return o.manifestJson ?? manifest(release.split('.').slice(0, 2).join('.'), o.arch ?? 'x86_64', apk ? 'apk' : 'ipk');
    },
    download: async (url) => {
      downloads.push(url);
      if (o.downloadFails) throw new Error('network down');
      const pkg = PACKAGES.find((p) => url.endsWith(`/${p}.${apk ? 'apk' : 'ipk'}`))!;
      return pkg === o.corrupt ? new Uint8Array(10) : bytesOf(pkg);
    },
    sha256: async (b) => sha(b),
    onStep: (s) => steps.push(s),
    sleep: async () => undefined,
  };
  return { conn, deps, steps, downloads, manifests };
}

const names = (steps: InstallStep[]) =>
  steps.map((s) => ('index' in s ? `${s.step}${s.index}` : s.step)).filter((s, i, all) => s !== all[i - 1]);

describe('installAgent', () => {
  it('goes detect → manifest → download → upload/install each → verify → done', async () => {
    const h = harness();
    await expect(installAgent(h.deps)).resolves.toEqual({ step: 'done', version: '0.1.0' });
    expect(names(h.steps)).toEqual([
      'detect',
      'manifest',
      'download0',
      'download1',
      'download2',
      'upload0',
      'install0',
      'upload1',
      'install1',
      'upload2',
      'install2',
      'verify',
      'done',
    ]);
    expect(h.manifests).toEqual([MANIFEST_URL]);
    expect(h.conn.execs.map((a) => a.slice(1).join(' '))).toEqual(Array(3).fill('install /tmp/upload.ipk'));
  });

  it('reports upload progress in bytes', async () => {
    const h = harness();
    await installAgent(h.deps);
    const uploads = h.steps.filter((s): s is Extract<InstallStep, { step: 'upload' }> => s.step === 'upload' && s.index === 0);
    expect(uploads[uploads.length - 1]).toMatchObject({ sent: bytesOf('routelinkd').length, size: bytesOf('routelinkd').length });
  });

  it('updates the package lists first when there are none', async () => {
    const h = harness({ lists: false });
    await installAgent(h.deps);
    expect(names(h.steps).slice(0, 6)).toEqual(['detect', 'manifest', 'download0', 'download1', 'download2', 'lists']);
    expect(h.conn.execs[0].slice(1)).toEqual(['update']);
  });

  it('passes the dummy argument 23.05 needs for update', async () => {
    const h = harness({ release: '23.05.6', helper: OPKG_CALL, lists: false });
    await installAgent(h.deps);
    expect(h.conn.execs[0]).toEqual([OPKG_CALL, 'update', '-q']);
  });

  it('trusts the signing key before installing apk packages, and only then', async () => {
    const apk = harness({ release: '25.12.5', apk: true });
    await expect(installAgent(apk.deps)).resolves.toMatchObject({ step: 'done' });
    const keyWrite = apk.conn.calls.findIndex((c) => c.method === 'write' && c.params?.path === '/etc/apk/keys/routelink.pem');
    const firstUpload = apk.conn.calls.findIndex((c) => c.method === 'write' && c.params?.path === '/tmp/upload.apk');
    expect(keyWrite).toBeGreaterThanOrEqual(0);
    expect(keyWrite).toBeLessThan(firstUpload);

    const opkg = harness();
    await installAgent(opkg.deps);
    expect(opkg.conn.calls.some((c) => c.params?.path === '/etc/apk/keys/routelink.pem')).toBe(false);
  });

  it('puts the mirror in front of the manifest and every download', async () => {
    const h = harness();
    await installAgent(h.deps, 'https://mirror.example/');
    expect([...h.manifests, ...h.downloads].every((u) => u.startsWith('https://mirror.example/https://'))).toBe(true);
  });

  it('waits for the daemon to come up', async () => {
    const h = harness({ slowStart: 3 });
    await expect(installAgent(h.deps)).resolves.toMatchObject({ step: 'done' });
  });

  describe('fails with a reason', () => {
    const failure = async (o: Setup) => {
      const h = harness(o);
      const result = await installAgent(h.deps);
      expect(h.steps[h.steps.length - 1]).toEqual(result);
      return { result, h };
    };

    it('not-root', async () => {
      expect((await failure({ access: false })).result).toEqual({ step: 'failed', reason: 'not-root' });
    });

    it('no-helper', async () => {
      expect((await failure({ helper: null })).result).toMatchObject({ reason: 'no-helper' });
    });

    it('unsupported-release and unsupported-arch', async () => {
      const other = manifest('22.03', 'x86_64');
      expect((await failure({ manifestJson: other })).result).toMatchObject({ reason: 'unsupported-release' });
      expect((await failure({ arch: 'mips_24kc', manifestJson: manifest('24.10') })).result).toMatchObject({
        reason: 'unsupported-arch',
      });
    });

    it('no-space, with what is needed and what is left', async () => {
      const { result } = await failure({ availKb: 100 });
      expect(result).toMatchObject({ reason: 'no-space', detail: expect.stringMatching(/^\d+\/100$/) });
    });

    it('download, including a manifest that is not one', async () => {
      expect((await failure({ downloadFails: true })).result).toMatchObject({ reason: 'download' });
      expect((await failure({ manifestJson: '<html>blocked</html>' })).result).toMatchObject({ reason: 'download' });
    });

    it('checksum, without uploading anything', async () => {
      const { result, h } = await failure({ corrupt: 'luci-app-routelink' });
      expect(result).toMatchObject({ reason: 'checksum', detail: 'luci-app-routelink.ipk' });
      expect(h.conn.calls.some((c) => c.method === 'write')).toBe(false);
    });

    it('upload', async () => {
      expect((await failure({ writeFails: true })).result).toMatchObject({ reason: 'upload' });
    });

    it('lists', async () => {
      const { result } = await failure({ lists: false, update: helperOut(255, '', 'Failed to download') });
      expect(result).toMatchObject({ reason: 'lists', detail: 'Failed to download' });
    });

    it('dependencies, naming what is missing (opkg and apk wording)', async () => {
      const opkg = await failure({
        install: () =>
          helperOut(
            255,
            '',
            ' * satisfy_dependencies_for: Cannot satisfy the following dependencies for routelinkd:\n * \tlibmnl0\n * opkg_install_cmd: Cannot install package routelinkd.',
          ),
      });
      expect(opkg.result).toMatchObject({ reason: 'dependencies', detail: 'libmnl0' });
      const apk = await failure({
        release: '25.12.5',
        apk: true,
        install: () =>
          helperOut(
            1,
            '',
            'ERROR: unable to select packages:\n  libmnl0 (no such package):\n    required by: routelinkd-0.1.0-r1[libmnl0]\n  kmod-nf-conntrack-netlink (no such package):\n    required by: routelinkd-0.1.0-r1[kmod-nf-conntrack-netlink]',
          ),
      });
      expect(apk.result).toMatchObject({ reason: 'dependencies', detail: 'libmnl0, kmod-nf-conntrack-netlink' });
      const cannotFind = await failure({ install: () => helperOut(255, '', 'cannot find dependency libubus20250102 for routelinkd') });
      expect(cannotFind.result).toMatchObject({ reason: 'dependencies', detail: 'libubus20250102' });
    });

    it('install', async () => {
      const { result } = await failure({ install: () => helperOut(1, '', 'opkg: out of memory') });
      expect(result).toMatchObject({ reason: 'install', detail: 'opkg: out of memory' });
    });

    it('verify', async () => {
      expect((await failure({ neverStarts: true })).result).toMatchObject({ reason: 'verify' });
    });
  });
});
