import type { InstallDeps } from './install';
import { INSTALL_ORDER } from './manifest';

/** Fake package contents for the demo router: no network, same flow, about the time a real install takes. */
const SIZES: Record<string, number> = {
  routelinkd: 92_416,
  'luci-app-routelink': 12_564,
  'luci-i18n-routelink-zh-cn': 3_827,
};

const bytesOf = (pkg: string) => new Uint8Array(SIZES[pkg] ?? 1024).map((_, i) => (i * 31 + pkg.length) & 0xff);
const urlOf = (pkg: string) =>
  `https://github.com/tsix2019/RouteLink/releases/download/agent-v1.0.0/${pkg}_1.0.0-r1_24.10_aarch64_cortex-a53.ipk`;

/** Manifest and downloads for the demo router (24.10, aarch64_cortex-a53); `sha256` is the app's real hash. */
export function demoInstallDeps(
  sha256: InstallDeps['sha256'],
  latencyMs = 900,
): Pick<InstallDeps, 'fetchManifest' | 'download'> {
  const wait = () => new Promise((resolve) => setTimeout(resolve, latencyMs));
  return {
    async fetchManifest() {
      await wait();
      const files = await Promise.all(
        INSTALL_ORDER.map(async (pkg) => ({
          package: pkg,
          name: `${pkg}_1.0.0-r1_24.10_aarch64_cortex-a53.ipk`,
          url: urlOf(pkg),
          sha256: await sha256(bytesOf(pkg)),
          size: SIZES[pkg],
        })),
      );
      return {
        version: '1.0.0',
        api: 1,
        tag: 'agent-v1.0.0',
        targets: { '24.10/aarch64_cortex-a53': { format: 'ipk', files } },
      };
    },
    async download(url) {
      await wait();
      const pkg = INSTALL_ORDER.find((p) => url.endsWith(urlOf(p)));
      if (!pkg) throw new Error(`demo: no package at ${url}`);
      return bytesOf(pkg);
    },
  };
}
