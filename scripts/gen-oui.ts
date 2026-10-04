// Builds src/data/oui.json from the IEEE MA-L registry. Run: npx tsx scripts/gen-oui.ts [path/to/oui.csv]
// Format: { v: vendor names, p: sorted fixed-width records "PREFIX(6 hex) + vendor index(3 base36)" }.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'https://standards-oui.ieee.org/oui/oui.csv';
const MAX_NAME = 24;

/** Minimal RFC 4180 line parser (fields may be quoted and contain commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const SUFFIXES = [
  /[,\s]+(co\.?,?\s*)?ltd\.?$/i,
  /[,\s]+inc\.?$/i,
  /[,\s]+incorporated$/i,
  /[,\s]+corporat(ion|e)$/i,
  /[,\s]+corp\.?$/i,
  /[,\s]+limited$/i,
  /[,\s]+llc\.?$/i,
  /[,\s]+(gmbh|ag|s\.?a\.?|b\.?v\.?|s\.?r\.?l\.?|oy|ab|as|kg|plc|pte|pty)\.?$/i,
  /[,\s]+co\.?$/i,
  /[,\s]+(technologies|technology|tech)$/i,
];

export function shortenVendor(name: string): string {
  let s = name.trim().replace(/\s+/g, ' ');
  for (let round = 0; round < 4; round++) {
    const before = s;
    for (const re of SUFFIXES) s = s.replace(re, '');
    s = s.replace(/[\s,.\-]+$/, '');
    if (s === before) break;
  }
  if (!s) s = name.trim();
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME).trimEnd() : s;
}

async function main() {
  const local = process.argv[2];
  const csv = local
    ? readFileSync(local, 'utf8')
    : await (await fetch(SOURCE, { headers: { 'User-Agent': 'RouteLink-build' } })).text();

  const byPrefix = new Map<string, string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (!line.startsWith('MA-L,')) continue;
    const [, prefix, org] = parseCsvLine(line);
    if (/^[0-9A-F]{6}$/.test(prefix) && org) byPrefix.set(prefix, shortenVendor(org));
  }

  const vendors: string[] = [];
  const index = new Map<string, number>();
  const records = [...byPrefix.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([prefix, vendor]) => {
      if (!index.has(vendor)) {
        index.set(vendor, vendors.length);
        vendors.push(vendor);
      }
      return prefix + index.get(vendor)!.toString(36).padStart(3, '0');
    });
  if (vendors.length >= 36 ** 3) throw new Error('vendor index overflow');

  const out = join(__dirname, '..', 'src', 'data', 'oui.json');
  writeFileSync(out, JSON.stringify({ v: vendors, p: records.join('') }));
  console.log(`prefixes=${records.length} vendors=${vendors.length} -> ${out}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
