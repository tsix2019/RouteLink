// A stand-in for GitHub Releases, to try the software update on an emulator (M5 T16):
//   npx tsx scripts/mock-releases.ts --apk <path> --version 1.1.1 [--port 8787] [--bad-digest] [--slow]
// Start the development build with EXPO_PUBLIC_RELEASES_URL=http://10.0.2.2:8787 (the emulator's way to the
// host). /releases/latest and /releases?per_page=N answer one release, v<version>, whose APK is served from
// /download/RouteLink-v<version>.apk with its real size and SHA-256 (a wrong digest with --bad-digest).
// --slow sends the APK at about 256 KB/s, so a download can be cancelled halfway.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const apkPath = arg('apk');
const version = arg('version');
const port = Number(arg('port') ?? 8787);
if (!apkPath || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    'usage: npx tsx scripts/mock-releases.ts --apk <path> --version X.Y.Z [--port 8787] [--bad-digest] [--slow]',
  );
  process.exit(2);
}

const name = `RouteLink-v${version}.apk`;
const size = statSync(apkPath).size;
const sha256 = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
const digest = flag('bad-digest') ? `sha256:${'0'.repeat(64)}` : `sha256:${sha256}`;

const body = [
  `模拟发布 v${version}，用来测试软件更新。English below.`,
  '',
  '### 新功能',
  '',
  '- 表单改成了二级页面。',
  '- 关于 → 软件更新。',
  '',
  '---',
  '',
  `A mock release, v${version}, for trying the software update.`,
  '',
  '### New',
  '',
  '- Forms open as pages.',
  '- About → Software Update.',
].join('\n');

const release = (host: string) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  published_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  html_url: `http://${host}/releases/tag/v${version}`,
  body,
  assets: [{ name, size, browser_download_url: `http://${host}/download/${name}`, digest }],
});

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sendApk(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': size });
  const stream = createReadStream(apkPath!, { highWaterMark: 64 * 1024 });
  req.on('close', () => stream.destroy());
  if (!flag('slow')) {
    stream.pipe(res);
    return;
  }
  // About 256 KB/s: one 64 KB chunk every 250 ms.
  stream.on('data', (chunk) => {
    stream.pause();
    res.write(chunk);
    setTimeout(() => stream.resume(), 250);
  });
  stream.on('end', () => res.end());
}

createServer((req, res) => {
  const host = req.headers.host ?? `localhost:${port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);
  console.log(`${req.method} ${url.pathname}${url.search}`);
  if (url.pathname === '/releases/latest') return json(res, 200, release(host));
  if (url.pathname === '/releases') return json(res, 200, [release(host)]);
  if (url.pathname === `/download/${name}`) return sendApk(req, res);
  if (url.pathname.startsWith('/releases/tag/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<h1>RouteLink v${version} (mock)</h1><p><a href="/download/${name}">${name}</a></p>`);
  }
  json(res, 404, { message: 'Not Found' });
}).listen(port, () => {
  console.log(
    `mock releases on :${port} — v${version}, ${name}, ${size} bytes, ${digest}${flag('slow') ? ', slow' : ''}`,
  );
});
