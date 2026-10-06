import latest from '../../../test/fixtures/github/latest.json';
import { DEFAULT_SETTINGS, useSettings } from '@/state/settings';

import { CHECK_INTERVAL_MS, checkForUpdate, hasUpdate, shouldAutoCheck } from './check';
import { UpdateError, type FetchJson } from './releases';

const NOW = Date.UTC(2026, 9, 6, 12);
const answer =
  (json: unknown, status = 200): FetchJson =>
  async () => ({ status, json });

beforeEach(() => useSettings.setState({ ...DEFAULT_SETTINGS }));

describe('shouldAutoCheck', () => {
  it('never checks while the switch is off', () => {
    expect(shouldAutoCheck({ updateAutoCheck: false, updateCheckedAt: 0 }, NOW)).toBe(false);
  });

  it('checks once a day at most', () => {
    const on = (ago: number) => shouldAutoCheck({ updateAutoCheck: true, updateCheckedAt: NOW - ago }, NOW);
    expect(on(CHECK_INTERVAL_MS - 60_000)).toBe(false);
    expect(on(CHECK_INTERVAL_MS)).toBe(true);
    expect(on(25 * 3600_000)).toBe(true);
  });

  it('checks when it never has, or when the clock went back', () => {
    expect(shouldAutoCheck({ updateAutoCheck: true, updateCheckedAt: 0 }, NOW)).toBe(true);
    expect(shouldAutoCheck({ updateAutoCheck: true, updateCheckedAt: NOW + 3600_000 }, NOW)).toBe(true);
  });
});

describe('hasUpdate', () => {
  it('is true only for a newer version', () => {
    expect(hasUpdate({ version: '1.1.0' }, '1.0.0')).toBe(true);
    expect(hasUpdate({ version: '1.10.0' }, '1.9.0')).toBe(true);
    expect(hasUpdate({ version: '1.0.0' }, '1.0.0')).toBe(false);
    expect(hasUpdate({ version: '0.9.0' }, '1.0.0')).toBe(false);
  });

  it('is false without a release or with versions it cannot read', () => {
    expect(hasUpdate(null, '1.0.0')).toBe(false);
    expect(hasUpdate(undefined, '1.0.0')).toBe(false);
    expect(hasUpdate({ version: '1.1.0' }, 'dev')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('stores the release without its notes and the time, and says whether it is newer', async () => {
    const result = await checkForUpdate({ fetchJson: answer(latest), now: NOW, current: '0.3.1' });
    expect(result.newer).toBe(true);
    expect(result.release.notes).toBe(latest.body);
    const { updateLatest, updateCheckedAt } = useSettings.getState();
    expect(updateCheckedAt).toBe(NOW);
    expect(updateLatest).toEqual({
      version: '1.0.0',
      tag: 'v1.0.0',
      publishedAt: '2026-10-06T03:03:15Z',
      htmlUrl: 'https://github.com/tsix2019/RouteLink/releases/tag/v1.0.0',
      apk: expect.objectContaining({ name: 'RouteLink-v1.0.0.apk', size: 37233386 }),
    });
    expect(updateLatest).not.toHaveProperty('notes');
  });

  it('is not newer when this is the version installed', async () => {
    expect((await checkForUpdate({ fetchJson: answer(latest), now: NOW, current: '1.0.0' })).newer).toBe(false);
  });

  it('leaves the settings alone when the check fails', async () => {
    useSettings.setState({ updateCheckedAt: 5 });
    await expect(checkForUpdate({ fetchJson: answer(null, 429), now: NOW, current: '1.0.0' })).rejects.toBeInstanceOf(
      UpdateError,
    );
    expect(useSettings.getState()).toMatchObject({ updateCheckedAt: 5, updateLatest: null });
  });
});

describe('autoCheckIfDue', () => {
  // Imported here: the hook module keeps the one running check in a module variable.
  const { autoCheckIfDue } = jest.requireActual<typeof import('./useAutoUpdateCheck')>('./useAutoUpdateCheck');

  it('runs one check at a time, and only when due', async () => {
    let finish = () => {};
    const check = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    autoCheckIfDue(NOW, check);
    expect(check).not.toHaveBeenCalled();

    useSettings.setState({ updateAutoCheck: true, updateCheckedAt: 0 });
    autoCheckIfDue(NOW, check);
    autoCheckIfDue(NOW, check);
    expect(check).toHaveBeenCalledTimes(1);

    finish();
    await new Promise((r) => setTimeout(r, 0));
    autoCheckIfDue(NOW, check);
    expect(check).toHaveBeenCalledTimes(2);
    finish();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('keeps failures quiet', async () => {
    useSettings.setState({ updateAutoCheck: true, updateCheckedAt: 0 });
    const check = jest.fn(() => Promise.reject(new UpdateError('network')));
    expect(() => autoCheckIfDue(NOW, check)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    autoCheckIfDue(NOW, check);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
