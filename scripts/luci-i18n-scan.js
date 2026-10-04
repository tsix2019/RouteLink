#!/usr/bin/env node
// Extracts translatable strings of luci-app-routelink into po/templates/routelink.pot:
// _('...') / _("...") in htdocs JS, and menu titles in root/usr/share/luci/menu.d.
// Usage: node scripts/luci-i18n-scan.js   (then update po/zh_Hans/routelink.po)
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(path.dirname(process.argv[1]), '..', 'openwrt', 'luci-app-routelink');
const strings = new Map(); // msgid -> [locations]

function add(msgid, where) {
  if (!strings.has(msgid)) strings.set(msgid, []);
  strings.get(msgid).push(where);
}

function walk(dir, ext, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, fn);
    else if (p.endsWith(ext)) fn(p);
  }
}

const call = /\b_\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
walk(path.join(app, 'htdocs'), '.js', (file) => {
  const rel = path.relative(app, file).split(path.sep).join('/');
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(call)) {
        const raw = m[1] ?? m[2];
        add(raw.replace(/\\(['"\\])/g, '$1'), `${rel}:${i + 1}`);
      }
    });
});
walk(path.join(app, 'root', 'usr', 'share', 'luci', 'menu.d'), '.json', (file) => {
  const rel = path.relative(app, file).split(path.sep).join('/');
  for (const entry of Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))))
    if (entry.title) add(entry.title, rel);
});

const quote = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
let pot = 'msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8"\n';
for (const [msgid, where] of [...strings].sort((a, b) => a[0].localeCompare(b[0]))) {
  pot += `\n#: ${where.join(' ')}\nmsgid ${quote(msgid)}\nmsgstr ""\n`;
}
const out = path.join(app, 'po', 'templates', 'routelink.pot');
fs.writeFileSync(out, pot);
console.log(`${strings.size} strings -> ${path.relative(process.cwd(), out)}`);

// Report msgids missing from the zh_Hans translation.
const poFile = path.join(app, 'po', 'zh_Hans', 'routelink.po');
if (fs.existsSync(poFile)) {
  const po = fs.readFileSync(poFile, 'utf8');
  const have = new Set([...po.matchAll(/^msgid "((?:[^"\\]|\\.)*)"$/gm)].map((m) => m[1].replace(/\\(["\\])/g, '$1')));
  const missing = [...strings.keys()].filter((s) => !have.has(s));
  if (missing.length) {
    console.log(`missing in zh_Hans (${missing.length}):\n  ` + missing.join('\n  '));
    process.exitCode = 1;
  }
}
