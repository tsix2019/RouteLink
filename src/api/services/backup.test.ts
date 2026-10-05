import { FixtureConnection, ok } from '../../../test/fixture-connection';
import type { UbusCall } from '../ubus/types';
import {
  backupContents,
  backupFileList,
  backupFileName,
  BACKUP_PATH,
  downloadBackup,
  isGzip,
  restoreBackup,
  uploadBackup,
} from './backup';

const gz = new Uint8Array(64).map((_, i) => (i === 0 ? 0x1f : i === 1 ? 0x8b : i));
const execOf = (c: UbusCall) =>
  [String((c.params as { command: string }).command), ...((c.params as { params?: string[] }).params ?? [])].join(' ');

describe('backups', () => {
  it('names the file like LuCI does', () => {
    expect(backupFileName('RouteLink-Demo', new Date(2026, 9, 5))).toBe('backup-RouteLink-Demo-2026-10-05.tar.gz');
    expect(backupFileName('my router', new Date(2026, 0, 9))).toBe('backup-my_router-2026-01-09.tar.gz');
  });

  it('downloads through the connection and checks for gzip', async () => {
    const conn = Object.assign(new FixtureConnection(), { downloadBackup: async () => gz });
    expect(await downloadBackup(conn)).toBe(gz);
    const html = Object.assign(new FixtureConnection(), { downloadBackup: async () => new Uint8Array(40).fill(60) });
    await expect(downloadBackup(html)).rejects.toMatchObject({ code: 'backup-invalid' });
    await expect(downloadBackup(new FixtureConnection())).rejects.toMatchObject({ code: 'backup-unsupported' });
    expect(isGzip(gz)).toBe(true);
  });

  it('lists what a backup holds from the 24.10 recording', async () => {
    const files = await backupFileList(new FixtureConnection('openwrt-24.10.8'));
    expect(files).toContain('/etc/config/network');
  });

  it('uploads in pieces to the path LuCI allows', async () => {
    const conn = new FixtureConnection().override('file.write', ok({}));
    const big = new Uint8Array(100_000);
    big.set([0x1f, 0x8b]);
    await uploadBackup(conn, big);
    const paths = conn.calls.map((c) => (c.params as { path: string }).path);
    expect(paths.length).toBeGreaterThan(2);
    expect(new Set(paths)).toEqual(new Set([BACKUP_PATH]));
    await expect(uploadBackup(conn, new Uint8Array(40))).rejects.toMatchObject({ code: 'backup-invalid' });
  });

  it('accepts an archive with configuration files, with the exact command line', async () => {
    const conn = new FixtureConnection().override(
      'file.exec',
      ok({ code: 0, stdout: 'etc/\netc/config/\netc/config/network\n./etc/crontabs/root\n' }),
    );
    expect(await backupContents(conn)).toEqual(['etc/config/network', 'etc/crontabs/root']);
    expect(execOf(conn.calls[0])).toBe('/bin/tar -tzf /tmp/backup.tar.gz');
  });

  it('refuses an archive without etc/config', async () => {
    const conn = new FixtureConnection().override('file.exec', ok({ code: 0, stdout: 'home/user/photo.jpg\n' }));
    await expect(backupContents(conn)).rejects.toMatchObject({ code: 'backup-invalid' });
    const broken = new FixtureConnection().override('file.exec', ok({ code: 1, stderr: 'tar: invalid magic' }));
    await expect(backupContents(broken)).rejects.toMatchObject({ code: 'backup-invalid' });
  });

  it('restores, then reboots', async () => {
    const conn = new FixtureConnection().override('file.exec', ok({ code: 0 }));
    await restoreBackup(conn);
    expect(conn.calls.map(execOf)).toEqual(['/sbin/sysupgrade --restore-backup /tmp/backup.tar.gz', '/sbin/reboot']);
    const failing = new FixtureConnection().override('file.exec', ok({ code: 1, stderr: 'bad archive' }));
    await expect(restoreBackup(failing)).rejects.toMatchObject({ code: 'restore-failed' });
    expect(failing.calls).toHaveLength(1);
  });
});
