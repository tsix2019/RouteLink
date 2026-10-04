// Release assembly for the router plugin (CI, T27 of the P1 plan).
// Usage: npx tsx scripts/agent-manifest.ts <artifacts dir> <tag> <out dir>
//   <artifacts dir>/pkg-<release>-<arch>/   packages + feed index from the SDK build
//   <out dir>/assets/                      renamed packages + manifest.json for the GitHub release
//   <out dir>/pages/agent/                 signed feeds per <major.minor>/<arch>, manifest.json, keys/
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Install order: the daemon first (it brings the ACL), then the LuCI app, then its translation. */
export const PACKAGES = ['routelinkd', 'luci-app-routelink', 'luci-i18n-routelink-zh-cn'] as const;
export const API_VERSION = 1;

export interface ParsedFile {
  package: string;
  version: string;
  format: 'ipk' | 'apk';
}

/** routelinkd_0.1.0-r1_x86_64.ipk or routelinkd-0.1.0-r1.apk; null for index files and other packages. */
export function parsePackageFile(name: string): ParsedFile | null {
  // longest names first so luci-i18n-routelink-zh-cn is not read as luci-i18n-routelink
  for (const pkg of [...PACKAGES].sort((a, b) => b.length - a.length)) {
    const ipk = new RegExp(`^${pkg}_([^_]+)_[^.]+\\.ipk$`).exec(name);
    if (ipk) return { package: pkg, version: ipk[1], format: 'ipk' };
    const apk = new RegExp(`^${pkg}-(\\d[^/]*)\\.apk$`).exec(name);
    if (apk) return { package: pkg, version: apk[1], format: 'apk' };
  }
  return null;
}

/** "24.10.8" -> "24.10": what the app reads from `system board`. */
export const releaseKey = (release: string) => release.split('.').slice(0, 2).join('.');

export interface ManifestFile {
  package: string;
  name: string;
  url: string;
  sha256: string;
  size: number;
}

export interface Manifest {
  version: string;
  api: number;
  tag: string;
  released: string;
  prerelease: boolean;
  targets: Record<string, { format: 'ipk' | 'apk'; files: ManifestFile[] }>;
}

export interface BuildInput {
  version: string;
  api: number;
  tag: string;
  released: string;
  downloadBase: string;
  targets: { release: string; arch: string; files: { name: string; sha256: string; size: number }[] }[];
}

export function buildManifest(input: BuildInput): { manifest: Manifest; assets: { from: string; to: string }[] } {
  const manifest: Manifest = {
    version: input.version,
    api: input.api,
    tag: input.tag,
    released: input.released,
    prerelease: /-/.test(input.tag.replace(/^agent-v/, '')),
    targets: {},
  };
  const assets: { from: string; to: string }[] = [];
  for (const t of input.targets) {
    const key = releaseKey(t.release);
    const files: ManifestFile[] = [];
    let format: 'ipk' | 'apk' = 'ipk';
    for (const f of t.files) {
      const parsed = parsePackageFile(f.name);
      if (!parsed) continue;
      format = parsed.format;
      // release and arch in every name: assets of all targets share one GitHub release
      const unique = parsed.format === 'ipk'
        ? `${parsed.package}_${parsed.version}_${key}_${t.arch}.ipk`
        : `${parsed.package}-${parsed.version}_${key}_${t.arch}.apk`;
      files.push({ package: parsed.package, name: unique, url: `${input.downloadBase}/${unique}`, sha256: f.sha256, size: f.size });
      assets.push({ from: `${t.release}/${t.arch}/${f.name}`, to: unique });
    }
    files.sort((a, b) => PACKAGES.indexOf(a.package as never) - PACKAGES.indexOf(b.package as never));
    if (files.length) manifest.targets[`${key}/${t.arch}`] = { format, files };
  }
  return { manifest, assets };
}

function main(artifacts: string, tag: string, out: string) {
  const version = tag.replace(/^agent-v/, '').replace(/-.*$/, '');
  const repo = process.env.GITHUB_REPOSITORY ?? 'tsix2019/RouteLink';
  const targets: BuildInput['targets'] = [];
  const pages = join(out, 'pages', 'agent');
  for (const dir of readdirSync(artifacts)) {
    const m = /^pkg-(\d+\.\d+\.\d+)-(.+)$/.exec(dir);
    if (!m) continue;
    const [, release, arch] = m;
    const src = join(artifacts, dir);
    const files = readdirSync(src).map((name) => {
      const bytes = readFileSync(join(src, name));
      return { name, sha256: createHash('sha256').update(bytes).digest('hex'), size: statSync(join(src, name)).size };
    });
    targets.push({ release, arch, files });
    // the feed keeps the SDK's file names and index
    cpSync(src, join(pages, releaseKey(release), arch), { recursive: true });
  }
  const { manifest, assets } = buildManifest({
    version,
    api: API_VERSION,
    tag,
    released: new Date().toISOString(),
    downloadBase: `https://github.com/${repo}/releases/download/${tag}`,
    targets,
  });
  mkdirSync(join(out, 'assets'), { recursive: true });
  for (const a of assets) {
    const [release, arch, name] = a.from.split('/');
    copyFileSync(join(artifacts, `pkg-${release}-${arch}`, name), join(out, 'assets', a.to));
  }
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(out, 'assets', 'manifest.json'), json);
  writeFileSync(join(pages, 'manifest.json'), json);
  cpSync(join(__dirname, '..', 'openwrt', 'feed', 'keys'), join(pages, 'keys'), { recursive: true });
  console.log(`${assets.length} packages for ${Object.keys(manifest.targets).length} targets -> ${out}`);
}

if (require.main === module) {
  const [artifacts, tag, out] = process.argv.slice(2);
  if (!artifacts || !tag || !out) {
    console.error('usage: npx tsx scripts/agent-manifest.ts <artifacts dir> <tag> <out dir>');
    process.exit(2);
  }
  main(artifacts, tag, out);
}
