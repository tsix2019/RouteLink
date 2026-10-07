import { createHash } from 'crypto';

import { cleanUpdates, openInstaller, prepareApk, type ApkDeps, type ApkFile } from './install';
import { UpdateError, type AppRelease } from './releases';

type Apk = NonNullable<AppRelease['apk']>;

const GOOD = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class FakeFile implements ApkFile {
  exists = false;
  size: number | null = null;
  data: Uint8Array = new Uint8Array();
  deleted = 0;
  constructor(readonly name: string) {}
  get contentUri() {
    return `content://app.routelink/cache/updates/${this.name}`;
  }
  async bytes() {
    return this.data;
  }
  write(data: Uint8Array) {
    this.data = data;
    this.exists = true;
    this.size = data.length;
  }
  delete() {
    this.exists = false;
    this.size = null;
    this.deleted++;
  }
}

const apk = (over: Partial<Apk> = {}): Apk => ({
  name: 'RouteLink-v1.1.0.apk',
  url: 'https://github.com/tsix2019/RouteLink/releases/download/v1.1.0/RouteLink-v1.1.0.apk',
  size: GOOD.length,
  sha256: hex(GOOD),
  ...over,
});

/** A download that writes `serve` (or fails with `fail`), reporting progress halfway. */
function setup({ serve = GOOD, fail }: { serve?: Uint8Array; fail?: Error } = {}) {
  const file = new FakeFile('RouteLink-v1.1.0.apk');
  const urls: string[] = [];
  const hashed: Uint8Array[] = [];
  const deps: ApkDeps = {
    file: (name) => {
      expect(name).toBe(file.name);
      return file;
    },
    download: async (url, target, { onProgress, signal }) => {
      urls.push(url);
      onProgress?.({ bytesWritten: serve.length / 2, totalBytes: serve.length });
      // The real download leaves part of the file behind when it stops.
      (target as FakeFile).write(serve.slice(0, serve.length / 2));
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (fail) throw fail;
      (target as FakeFile).write(serve);
    },
    sha256: async (bytes) => {
      hashed.push(bytes);
      return hex(bytes);
    },
  };
  return { file, urls, hashed, deps };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

describe('prepareApk', () => {
  it('downloads and verifies the APK, then the installer opens it', async () => {
    const { file, urls, deps } = setup();
    const progress: number[] = [];
    const ready = await prepareApk(apk(), { onProgress: (p) => progress.push(p.bytesWritten) }, deps);
    expect(ready).toBe(file);
    expect(urls).toEqual([apk().url]);
    expect(progress).toEqual([4]);

    const launch = jest.fn(async () => ({ resultCode: 0 }));
    await openInstaller(ready, launch);
    expect(launch).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://app.routelink/cache/updates/RouteLink-v1.1.0.apk',
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
  });

  it('deletes a download of the wrong size or digest and says it failed verification', async () => {
    for (const serve of [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1])]) {
      const { file, deps } = setup({ serve });
      const error = await failure(prepareApk(apk(), {}, deps));
      expect(error).toBeInstanceOf(UpdateError);
      expect((error as UpdateError).code).toBe('verify');
      expect(file.exists).toBe(false);
    }
  });

  it('only compares the size when the release has no digest', async () => {
    const { hashed, deps } = setup({ serve: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) });
    await expect(prepareApk(apk({ sha256: undefined }), {}, deps)).resolves.toBeDefined();
    expect(hashed).toEqual([]);
  });

  it('uses a verified earlier download as it is', async () => {
    const { file, urls, deps } = setup();
    file.write(GOOD);
    await expect(prepareApk(apk(), {}, deps)).resolves.toBe(file);
    expect(urls).toEqual([]);
  });

  it('downloads again over an earlier file that does not verify', async () => {
    const { file, urls, deps } = setup();
    file.write(new Uint8Array([0, 0, 0]));
    await expect(prepareApk(apk(), {}, deps)).resolves.toBe(file);
    expect(urls).toHaveLength(1);
    expect(file.data).toEqual(GOOD);
  });

  it('deletes the partial file when cancelled and passes the AbortError on', async () => {
    const { file, deps } = setup();
    const controller = new AbortController();
    controller.abort();
    const error = await failure(prepareApk(apk(), { signal: controller.signal }, deps));
    expect(error?.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(UpdateError);
    expect(file.exists).toBe(false);
  });

  it('deletes the partial file when the download fails, keeping the reason', async () => {
    const { file, deps } = setup({ fail: new Error('UnableToDownload: HTTP 404') });
    const error = await failure(prepareApk(apk(), {}, deps));
    expect(error).toBeInstanceOf(UpdateError);
    expect((error as UpdateError).code).toBe('download');
    expect((error as UpdateError).detail).toBe('UnableToDownload: HTTP 404');
    expect(file.exists).toBe(false);
  });

  it('puts the mirror in front of the download address', async () => {
    const { urls, deps } = setup();
    await prepareApk(apk(), { mirror: 'https://ghproxy.example/' }, deps);
    expect(urls).toEqual([`https://ghproxy.example/${apk().url}`]);
  });
});

describe('openInstaller', () => {
  it('turns a refusal into an installer error', async () => {
    const error = await failure(
      openInstaller(new FakeFile('a.apk'), async () => {
        throw new Error('No Activity found to handle Intent');
      }),
    );
    expect(error).toBeInstanceOf(UpdateError);
    expect((error as UpdateError).code).toBe('installer');
  });
});

describe('cleanUpdates', () => {
  it('deletes everything but the newest APK', () => {
    const files = ['RouteLink-v1.0.0.apk', 'RouteLink-v1.1.0.apk', 'stray.tmp'].map((n) => new FakeFile(n));
    cleanUpdates(() => files, 'RouteLink-v1.1.0.apk');
    expect(files.map((f) => f.deleted)).toEqual([1, 0, 1]);
  });

  it('deletes everything without a newest one, and survives a file it cannot delete', () => {
    const stuck = new FakeFile('stuck.apk');
    stuck.delete = () => {
      throw new Error('busy');
    };
    const other = new FakeFile('RouteLink-v1.0.0.apk');
    expect(() => cleanUpdates(() => [stuck, other])).not.toThrow();
    expect(other.deleted).toBe(1);
  });
});
