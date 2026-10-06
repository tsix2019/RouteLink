import type { AppLanguage } from '@/i18n';

/** The app's GitHub repository in the REST API. Releases there carry the APK and IPA. */
export const RELEASES_API = 'https://api.github.com/repos/tsix2019/RouteLink';

/** GitHub, or in a development build `EXPO_PUBLIC_RELEASES_URL` (scripts/mock-releases.ts). */
export function releasesBase(): string {
  const override = __DEV__ ? process.env.EXPO_PUBLIC_RELEASES_URL : undefined;
  return override || RELEASES_API;
}

export interface AppRelease {
  /** "1.1.0" */
  version: string;
  /** "v1.1.0" */
  tag: string;
  publishedAt: string;
  /** The release page on github.com. */
  htmlUrl: string;
  /** The release text, both languages (see notesFor). */
  notes: string;
  /** `RouteLink-v<version>.apk`, when the release has one. */
  apk?: { name: string; url: string; size: number; sha256?: string };
}

export type UpdateErrorCode =
  | 'network'
  | 'rate-limited'
  | 'no-release'
  /** The APK download failed (not cancelled); `detail` says why. */
  | 'download'
  /** The APK's size or SHA-256 is not the release's. */
  | 'verify'
  /** The system would not open the installer. */
  | 'installer';

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'UpdateError';
  }
}

/** One GET; `status` is the HTTP status, `json` the parsed body (undefined when it is not JSON). */
export type FetchJson = (url: string) => Promise<{ status: number; json: unknown }>;

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const SHA256 = /^sha256:([0-9a-f]{64})$/i;

export function parseVersion(v: string): [number, number, number] | null {
  const m = VERSION.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Above 0 when `a` is newer, 0 when the same; null when either is not X.Y.Z. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

function toApk(assets: unknown, version: string): AppRelease['apk'] {
  if (!Array.isArray(assets)) return undefined;
  const name = `RouteLink-v${version}.apk`;
  const a = assets.find((x): x is Raw => isObj(x) && x.name === name);
  if (!a) return undefined;
  const { browser_download_url: url, size, digest } = a;
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url) || typeof size !== 'number' || size <= 0) {
    return undefined;
  }
  const sha256 = typeof digest === 'string' ? SHA256.exec(digest)?.[1]?.toLowerCase() : undefined;
  return { name, url, size, sha256 };
}

/** A published app release (`vX.Y.Z`, not a draft or prerelease), or null for anything else. */
function toRelease(raw: unknown): AppRelease | null {
  if (!isObj(raw)) return null;
  const { tag_name: tag, draft, prerelease, published_at: publishedAt, html_url: htmlUrl, body, assets } = raw;
  if (typeof tag !== 'string' || !TAG.test(tag) || draft !== false || prerelease !== false) return null;
  if (typeof publishedAt !== 'string' || typeof htmlUrl !== 'string') return null;
  const version = tag.slice(1);
  return {
    version,
    tag,
    publishedAt,
    htmlUrl,
    notes: typeof body === 'string' ? body : '',
    apk: toApk(assets, version),
  };
}

/** The newest app release in a `/releases` list; plugin releases, prereleases and drafts don't count. */
export function pickRelease(list: unknown): AppRelease | null {
  if (!Array.isArray(list)) return null;
  let best: AppRelease | null = null;
  for (const raw of list) {
    const r = toRelease(raw);
    if (r && (!best || compareVersions(r.version, best.version)! > 0)) best = r;
  }
  return best;
}

const SEPARATOR = /^\s*---\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Release notes are written Chinese, a line of `---`, then English. The first such line outside a code
 * block splits them; without one, both languages get the whole text.
 */
export function notesFor(body: string, lang: AppLanguage): string {
  const lines = body.split('\n');
  let fenced = false;
  const at = lines.findIndex((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    return !fenced && SEPARATOR.test(line);
  });
  if (at < 0) return body.trim();
  if (lang === 'en')
    return lines
      .slice(at + 1)
      .join('\n')
      .trim();
  // The Chinese half points readers to the English one, which the app does not show alongside.
  return lines
    .slice(0, at)
    .join('\n')
    .replace(/[ \t]*English below\.?[ \t]*(?=\r?$)/m, '')
    .trim();
}

async function get(fetchJson: FetchJson, url: string): Promise<{ status: number; json: unknown }> {
  let res;
  try {
    res = await fetchJson(url);
  } catch {
    // Offline, DNS, TLS, or the timeout.
    throw new UpdateError('network');
  }
  if (res.status === 403 || res.status === 429) throw new UpdateError('rate-limited');
  return res;
}

/**
 * The newest app release on GitHub. `/releases/latest` is the newest published release of any kind, so
 * when that is the plugin's (`agent-v…`) the last 20 releases are searched instead.
 */
export async function fetchLatestRelease(fetchJson: FetchJson, base = releasesBase()): Promise<AppRelease> {
  const root = base.replace(/\/+$/, '');
  const latest = await get(fetchJson, `${root}/releases/latest`);
  if (latest.status >= 200 && latest.status < 300) {
    const r = toRelease(latest.json);
    if (r) return r;
  } else if (latest.status !== 404) {
    throw new UpdateError('network');
  }
  const list = await get(fetchJson, `${root}/releases?per_page=20`);
  if (list.status < 200 || list.status >= 300) throw new UpdateError('network');
  const r = pickRelease(list.json);
  if (!r) throw new UpdateError('no-release');
  return r;
}
