import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { NativeError } from '../http/errors';
import { factoryReset, resetAddresses } from './maintenance';

describe('factory reset', () => {
  it('runs firstboot with LuCI’s command line, and does not mind the router going away', async () => {
    const conn = new FixtureConnection().override('file.exec', ok({ code: 0 }));
    await factoryReset(conn);
    expect(conn.calls[0].params).toEqual({ command: '/sbin/firstboot', params: ['-r', '-y'] });
    const gone = new FixtureConnection().override('file.exec', () => {
      throw new NativeError('ERR_UNREACHABLE', 'down');
    });
    await expect(factoryReset(gone)).resolves.toBeUndefined();
    const refused = new FixtureConnection().override('file.exec', ok({ code: 1, stderr: 'no overlay' }));
    await expect(factoryReset(refused)).rejects.toMatchObject({ code: 'reset-failed' });
  });

  it('watches the old address and OpenWrt’s default one', () => {
    expect(resetAddresses('https://10.0.0.1:8443')).toEqual(['http://10.0.0.1:8443', 'http://192.168.1.1']);
    expect(resetAddresses('http://192.168.1.1')).toEqual(['http://192.168.1.1']);
  });
});
