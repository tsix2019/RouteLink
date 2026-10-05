import type { RouterConnection } from '../connection/types';
import { parseHelperOutput, type PackageEnv } from './packages';

/**
 * The package page (MO-5) on top of LuCI's helper (see packages.ts): installed and available packages,
 * search, install by name. Listing goes through cgi-exec, which has no size limit: the available list is
 * several megabytes. Formats: opkg's control files up to 24.10, apk's JSON on 25.12.
 */
export interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  /** Installed size in bytes, when the list tells. */
  size?: number;
  depends: string[];
  /** Installed only as a dependency (opkg's "Auto-Installed: yes"); unknown on apk. */
  auto?: boolean;
}

const dependsOf = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((d) => d.trim().split(/\s/)[0])
    .filter(Boolean);

/** opkg's status file and feed lists: "Field: value" blocks; indented lines continue the previous field. */
export function parseControl(text: string): PackageInfo[] {
  const out: PackageInfo[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const fields: Record<string, string> = {};
    let last = '';
    for (const line of block.split('\n')) {
      if (/^\s/.test(line) && last) {
        fields[last] = `${fields[last]} ${line.trim()}`.trim();
        continue;
      }
      const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      last = m[1];
      fields[last] = m[2].trim();
    }
    if (!fields.Package) continue;
    const p: PackageInfo = { name: fields.Package, version: fields.Version ?? '', depends: dependsOf(fields.Depends) };
    if (fields.Description) p.description = fields.Description;
    const size = Number(fields['Installed-Size']);
    if (fields['Installed-Size'] && Number.isFinite(size)) p.size = size;
    // Only the status file says how a package got there.
    if (fields.Status !== undefined) p.auto = fields['Auto-Installed'] === 'yes';
    out.push(p);
  }
  return out;
}

/** `apk list --format json` style output (25.12's helper). */
export function parseApkJson(text: string): PackageInfo[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: Record<string, unknown> | null) => {
    if (!item || typeof item.name !== 'string') return [];
    const p: PackageInfo = {
      name: item.name,
      version: String(item.version ?? ''),
      depends: Array.isArray(item.depends) ? item.depends.map((d) => String(d).split(/[<>=~]/)[0]) : [],
    };
    if (typeof item.description === 'string' && item.description) p.description = item.description;
    if (typeof item['installed-size'] === 'number') p.size = item['installed-size'];
    return [p];
  });
}

const parse = (env: PackageEnv, text: string) =>
  env.manager === 'apk' && text.trimStart().startsWith('[') ? parseApkJson(text) : parseControl(text);

async function listing(conn: RouterConnection, env: PackageEnv, what: 'list-installed' | 'list-available') {
  if (conn.cgiExec) return parse(env, await conn.cgiExec([env.helper, what]));
  const r = await conn.call<{ stdout?: string }>('file', 'exec', { command: env.helper, params: [what] });
  return parse(env, r.stdout ?? '');
}

export const listInstalled = (conn: RouterConnection, env: PackageEnv) => listing(conn, env, 'list-installed');

/** Needs the feed lists (`updateLists`) first; without them the list is empty. */
export const listAvailable = (conn: RouterConnection, env: PackageEnv) => listing(conn, env, 'list-available');

/** Exact name, then name prefix, then name substring, then description; alphabetical within each. */
export function searchPackages(list: PackageInfo[], query: string, limit = 200): PackageInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const rank = (p: PackageInfo) => {
    const name = p.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    return p.description?.toLowerCase().includes(q) ? 3 : 4;
  };
  return list
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

const PACKAGE_NAME = /^[a-z0-9][a-z0-9+._-]*$/i;

/** Installs from the configured feeds (the lists must be fresh). */
export async function installPackages(
  conn: RouterConnection,
  env: PackageEnv,
  names: string[],
): Promise<{ ok: boolean; output: string }> {
  if (!names.length || names.some((n) => !PACKAGE_NAME.test(n))) throw new Error('invalid package name');
  if (!conn.cgiExec) throw new Error('this connection cannot run cgi-exec');
  const out = parseHelperOutput(await conn.cgiExec([env.helper, 'install', ...names]));
  return { ok: out.code === 0, output: [out.stdout, out.stderr].filter(Boolean).join('\n') };
}
