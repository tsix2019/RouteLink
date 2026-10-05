import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import type { UbusCall } from '../ubus/types';
import {
  AUTHORIZED_KEYS,
  addKeyLine,
  hasPublicKey,
  installPublicKey,
  keyOf,
  removeKeyLine,
  removePublicKey,
} from './ssh-keys';

const APP = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAppKeyAppKeyAppKeyAppKeyAppKeyAppKeyAppKey routelink';
const LAPTOP = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILaptopLaptopLaptopLaptopLaptopLaptopLapt me@laptop';
const RSA = 'command="uptime",no-pty ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCrestricted backup@nas';

describe('authorized_keys lines', () => {
  it('finds the key in a line, past options and before the comment', () => {
    expect(keyOf(APP)).toBe(APP.split(' ').slice(0, 2).join(' '));
    expect(keyOf(RSA)).toBe('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCrestricted');
    expect(keyOf('# a comment')).toBeNull();
    expect(keyOf('')).toBeNull();
  });

  it('adds a key once, keeping the other lines and a final newline', () => {
    expect(addKeyLine('', APP)).toBe(`${APP}\n`);
    expect(addKeyLine(`${LAPTOP}`, APP)).toBe(`${LAPTOP}\n${APP}\n`);
    expect(addKeyLine(`${LAPTOP}\n${RSA}\n`, APP)).toBe(`${LAPTOP}\n${RSA}\n${APP}\n`);
    // Already there, even under another comment: nothing to do.
    expect(addKeyLine(`${LAPTOP}\n${APP.replace('routelink', 'old phone')}\n`, APP)).toBeNull();
  });

  it('removes only that key', () => {
    expect(removeKeyLine(`${LAPTOP}\n${APP}\n${RSA}\n`, APP)).toBe(`${LAPTOP}\n${RSA}\n`);
    expect(removeKeyLine(`${APP}\n`, APP)).toBe('');
    expect(removeKeyLine(`${LAPTOP}\n`, APP)).toBeNull();
  });
});

describe('router calls', () => {
  const writes = (conn: FixtureConnection) =>
    conn.calls.filter((c: UbusCall) => c.object === 'file' && c.method === 'write').map((c) => c.params);

  it('installs into a missing file with owner-only permissions', async () => {
    const conn = new FixtureConnection().override('file.read', fail('NOT_FOUND')).override('file.write', ok({}));
    expect(await hasPublicKey(conn, APP)).toBe(false);
    expect(await installPublicKey(conn, APP)).toBe('installed');
    expect(writes(conn)).toEqual([{ path: AUTHORIZED_KEYS, data: `${APP}\n`, mode: 0o600 }]);
  });

  it('leaves a file that already has the key alone, and removes it again', async () => {
    const conn = new FixtureConnection()
      .override('file.read', ok({ data: `${LAPTOP}\n${APP}\n` }))
      .override('file.write', ok({}));
    expect(await hasPublicKey(conn, APP)).toBe(true);
    expect(await installPublicKey(conn, APP)).toBe('present');
    expect(writes(conn)).toEqual([]);
    expect(await removePublicKey(conn, APP)).toBe('removed');
    expect(writes(conn)).toEqual([{ path: AUTHORIZED_KEYS, data: `${LAPTOP}\n`, mode: 0o600 }]);
  });

  it('does not write over a file it could not read', async () => {
    const conn = new FixtureConnection().override('file.read', fail('PERMISSION_DENIED'));
    await expect(installPublicKey(conn, APP)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(writes(conn)).toEqual([]);
  });
});
