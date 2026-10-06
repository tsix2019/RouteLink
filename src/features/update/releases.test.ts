import latestAgent from '../../../test/fixtures/github/latest-agent.json';
import latest from '../../../test/fixtures/github/latest.json';
import releases from '../../../test/fixtures/github/releases.json';
import {
  compareVersions,
  fetchLatestRelease,
  notesFor,
  parseVersion,
  pickRelease,
  RELEASES_API,
  UpdateError,
  type FetchJson,
} from './releases';

const v100 = releases[0];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('parseVersion / compareVersions', () => {
  it('reads X.Y.Z, with or without a v', () => {
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0]);
    expect(parseVersion('v2.0.3')).toEqual([2, 0, 3]);
  });

  it('rejects anything else', () => {
    for (const bad of ['1.0', '1.0.0-rc.1', 'agent-v0.1.0', 'v1.0.0.1', '', 'x.y.z']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBeNull();
  });
});

describe('pickRelease', () => {
  it('takes the newest app release from the recorded list', () => {
    expect(pickRelease(releases)).toEqual({
      version: '1.0.0',
      tag: 'v1.0.0',
      publishedAt: '2026-10-06T03:03:15Z',
      htmlUrl: 'https://github.com/tsix2019/RouteLink/releases/tag/v1.0.0',
      notes: v100.body,
      apk: {
        name: 'RouteLink-v1.0.0.apk',
        url: 'https://github.com/tsix2019/RouteLink/releases/download/v1.0.0/RouteLink-v1.0.0.apk',
        size: 37233386,
        sha256: '6248ebf72279e186f6e4d6af563f253366c2528232654e93ea027ff8b919bf20',
      },
    });
  });

  it('ignores plugin releases, prereleases and drafts', () => {
    // Without v1.0.0 only prereleases (v0.x) and the plugin are left.
    expect(pickRelease(releases.slice(1))).toBeNull();
    const draft = { ...clone(v100), tag_name: 'v9.0.0', draft: true };
    const pre = { ...clone(v100), tag_name: 'v8.0.0', prerelease: true };
    expect(pickRelease([draft, pre, ...releases])?.version).toBe('1.0.0');
  });

  it('takes the highest version, not the first one listed', () => {
    const older = { ...clone(v100), tag_name: 'v1.2.0' };
    const newer = { ...clone(v100), tag_name: 'v1.10.0' };
    expect(pickRelease([older, newer, ...releases])?.version).toBe('1.10.0');
  });

  it('skips entries that are not well-formed', () => {
    const odd = [null, 'v2.0.0', { tag_name: 'v2.0.0' }, { ...clone(v100), tag_name: 'v2.0' }, ...releases];
    expect(pickRelease(odd)?.version).toBe('1.0.0');
    expect(pickRelease({ message: 'Not Found' })).toBeNull();
  });

  it('wants the APK named after the version exactly', () => {
    const r = clone(v100);
    r.assets = r.assets.map((a) => ({ ...a, name: a.name.replace('RouteLink-v1.0.0.apk', 'RouteLink.apk') }));
    expect(pickRelease([r])).toMatchObject({ version: '1.0.0', apk: undefined });
  });

  it('keeps the APK without a digest when the digest is not a SHA-256', () => {
    for (const digest of [null, 'sha512:abcd', 'sha256:xyz', undefined]) {
      const r = clone(v100);
      r.assets = r.assets.map((a) => ({ ...a, digest: digest as string }));
      expect(pickRelease([r])?.apk).toEqual({
        name: 'RouteLink-v1.0.0.apk',
        url: 'https://github.com/tsix2019/RouteLink/releases/download/v1.0.0/RouteLink-v1.0.0.apk',
        size: 37233386,
        sha256: undefined,
      });
    }
  });

  it('drops an APK with an unusable address or size', () => {
    const r = clone(v100);
    r.assets = r.assets.map((a) => ({ ...a, browser_download_url: 'ftp://example.com/x.apk' }));
    expect(pickRelease([r])?.apk).toBeUndefined();
    const s = clone(v100);
    s.assets = s.assets.map((a) => ({ ...a, size: 0 }));
    expect(pickRelease([s])?.apk).toBeUndefined();
  });
});

describe('notesFor', () => {
  it('splits the recorded body into its Chinese and English halves', () => {
    const zh = notesFor(v100.body, 'zh-CN');
    const en = notesFor(v100.body, 'en');
    expect(zh.startsWith('第四个里程碑（M4）')).toBe(true);
    expect(zh).not.toContain('The fourth milestone');
    expect(en.startsWith('The fourth milestone (M4)')).toBe(true);
    expect(en).not.toContain('第四个里程碑');
  });

  it('drops the "English below." pointer from the Chinese half', () => {
    expect(notesFor(v100.body, 'zh-CN').split('\n')[0]).toBe(
      '第四个里程碑（M4）：SSH 终端、AI 助手、桌面小组件和掉线通知。',
    );
    expect(notesFor('修复版。English below.\n\n---\n\nFixes.', 'zh-CN')).toBe('修复版。');
  });

  it('shows the whole text without a separator line', () => {
    expect(notesFor('Only one language.\n\nA --- B', 'zh-CN')).toBe('Only one language.\n\nA --- B');
    expect(notesFor('Only one language.', 'en')).toBe('Only one language.');
  });

  it('splits at the first separator line only, outside code blocks, and accepts CRLF', () => {
    const body = ['中文 --- 内容', '```', '---', '```', '---', 'English', '', '---', 'more'].join('\r\n');
    expect(notesFor(body, 'zh-CN')).toBe('中文 --- 内容\r\n```\r\n---\r\n```');
    expect(notesFor(body, 'en')).toBe('English\r\n\r\n---\r\nmore');
  });
});

describe('fetchLatestRelease', () => {
  const api = (routes: Record<string, { status: number; json?: unknown } | Error>) => {
    const calls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      calls.push(url);
      const r = routes[url.replace(RELEASES_API, '')];
      if (!r) throw new Error(`unexpected ${url}`);
      if (r instanceof Error) throw r;
      return { status: r.status, json: r.json };
    };
    return { fetchJson, calls };
  };

  it('uses /releases/latest when that is an app release', async () => {
    const { fetchJson, calls } = api({ '/releases/latest': { status: 200, json: latest } });
    expect((await fetchLatestRelease(fetchJson))?.version).toBe('1.0.0');
    expect(calls).toEqual([`${RELEASES_API}/releases/latest`]);
  });

  it('lists the recent releases when /latest is the plugin', async () => {
    const { fetchJson, calls } = api({
      '/releases/latest': { status: 200, json: latestAgent },
      '/releases?per_page=20': { status: 200, json: releases },
    });
    expect((await fetchLatestRelease(fetchJson))?.version).toBe('1.0.0');
    expect(calls).toEqual([`${RELEASES_API}/releases/latest`, `${RELEASES_API}/releases?per_page=20`]);
  });

  it('lists the recent releases when there is no latest one (404)', async () => {
    const { fetchJson } = api({
      '/releases/latest': { status: 404, json: { message: 'Not Found' } },
      '/releases?per_page=20': { status: 200, json: releases },
    });
    expect((await fetchLatestRelease(fetchJson))?.version).toBe('1.0.0');
  });

  it('asks another server when given one', async () => {
    const calls: string[] = [];
    await fetchLatestRelease(async (url) => {
      calls.push(url);
      return { status: 200, json: latest };
    }, 'http://10.0.2.2:8787/');
    expect(calls).toEqual(['http://10.0.2.2:8787/releases/latest']);
  });

  const failsWith = async (code: string, routes: Parameters<typeof api>[0]) => {
    const error = await fetchLatestRelease(api(routes).fetchJson).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpdateError);
    expect((error as UpdateError).code).toBe(code);
  };

  it('is rate-limited on 403 and 429', async () => {
    await failsWith('rate-limited', { '/releases/latest': { status: 403 } });
    await failsWith('rate-limited', {
      '/releases/latest': { status: 200, json: latestAgent },
      '/releases?per_page=20': { status: 429 },
    });
  });

  it('is a network error when the request fails or the server errs', async () => {
    await failsWith('network', { '/releases/latest': new Error('Network request failed') });
    await failsWith('network', { '/releases/latest': Object.assign(new Error('timed out'), { name: 'AbortError' }) });
    await failsWith('network', { '/releases/latest': { status: 502 } });
  });

  it('finds no release when nothing qualifies or the answer makes no sense', async () => {
    await failsWith('no-release', {
      '/releases/latest': { status: 200, json: latestAgent },
      '/releases?per_page=20': { status: 200, json: releases.slice(1) },
    });
    await failsWith('no-release', {
      '/releases/latest': { status: 200, json: '<html>' },
      '/releases?per_page=20': { status: 200, json: { not: 'a list' } },
    });
  });
});
