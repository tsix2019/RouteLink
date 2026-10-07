import type { PackageEnv } from '@/api/services/packages';

/** Written by scripts/agent-manifest.ts on every plugin release and published with the feed on GitHub Pages. */
export const MANIFEST_URL = 'https://tsix2019.github.io/RouteLink/agent/manifest.json';

/** The daemon first (it brings the ACL), then the LuCI app, then its translation. */
export const INSTALL_ORDER = ['routelinkd', 'luci-app-routelink', 'luci-i18n-routelink-zh-cn'] as const;

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
  tag?: string;
  prerelease?: boolean;
  /**
   * "<release>/<arch>" in the release's own format, e.g. "24.10/x86_64" (ipk) or "25.12/x86_64" (apk);
   * "<release>/<arch>/<format>" for the other one, e.g. "25.12/x86_64/ipk" for forks that kept opkg (Kwrt).
   */
  targets: Record<string, { format: 'ipk' | 'apk'; files: ManifestFile[] }>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

function parseFile(v: unknown): ManifestFile {
  if (!isObj(v)) throw new ManifestError('file entry is not an object');
  const { package: pkg, name, url, sha256, size } = v;
  if (
    typeof pkg !== 'string' ||
    typeof name !== 'string' ||
    typeof url !== 'string' ||
    !/^https:\/\//.test(url) ||
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(sha256) ||
    typeof size !== 'number'
  ) {
    throw new ManifestError(`bad file entry ${String(name ?? pkg)}`);
  }
  return { package: pkg, name, url, sha256: sha256.toLowerCase(), size };
}

/** Throws ManifestError for anything else (an HTML error page from a mirror, a truncated download). */
export function parseManifest(json: unknown): Manifest {
  if (!isObj(json) || typeof json.version !== 'string' || typeof json.api !== 'number' || !isObj(json.targets)) {
    throw new ManifestError('not a RouteLink plugin manifest');
  }
  const targets: Manifest['targets'] = {};
  for (const [key, t] of Object.entries(json.targets)) {
    if (!isObj(t) || (t.format !== 'ipk' && t.format !== 'apk') || !Array.isArray(t.files)) {
      throw new ManifestError(`bad target ${key}`);
    }
    targets[key] = { format: t.format, files: t.files.map(parseFile) };
  }
  return {
    version: json.version,
    api: json.api,
    tag: typeof json.tag === 'string' ? json.tag : undefined,
    prerelease: json.prerelease === true,
    targets,
  };
}

/**
 * The router's packages in install order, or why there are none. Packages are picked by the package
 * manager the router really has, not the one its release usually has: Kwrt 25.12 kept opkg.
 */
export function pickTarget(m: Manifest, env: PackageEnv): ManifestFile[] | 'unsupported-release' | 'unsupported-arch' {
  const format = env.manager === 'apk' ? 'apk' : 'ipk';
  const usable = Object.entries(m.targets)
    .filter(([, t]) => t.format === format)
    .map(([key, t]) => {
      const [release, arch] = key.split('/');
      return { release, arch, files: t.files };
    });
  const target = usable.find((t) => t.release === env.release && t.arch === env.arch);
  if (!target) {
    return usable.some((t) => t.release === env.release) ? 'unsupported-arch' : 'unsupported-release';
  }
  const order = INSTALL_ORDER as readonly string[];
  return target.files
    .filter((f) => order.includes(f.package))
    .sort((a, b) => order.indexOf(a.package) - order.indexOf(b.package));
}

/** Download mirrors work as a prefix ("https://ghproxy.example/https://github.com/..."); GitHub is slow in places. */
export function applyMirror(url: string, mirror?: string): string {
  const prefix = mirror?.trim();
  if (!prefix || !/^https?:\/\/\S+$/.test(prefix)) return url;
  return `${prefix.replace(/\/+$/, '')}/${url}`;
}
