import RouteLinkNative from 'routelink-native';

import { NativeError } from '../http/errors';
import { openTerminal, readHostKey, runCommand } from './client';

const native = RouteLinkNative as unknown as Record<string, jest.Mock> & {
  __emit(name: string, payload: unknown): void;
};
const OPTIONS = { host: '192.168.1.1', hostKey: 'SHA256:abc', password: 'pw' };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

beforeEach(() => {
  for (const name of ['sshOpen', 'sshWrite', 'sshResize', 'sshClose', 'sshHostKey', 'sshExec']) {
    native[name].mockReset();
  }
});

describe('openTerminal', () => {
  it('routes output by session, including what arrived before the id did', async () => {
    native.sshOpen.mockImplementation(async () => {
      // The shell's prompt can beat sshOpen's answer.
      native.__emit('onSshData', { id: 's1', data: b64('root@OpenWrt:~# ') });
      return 's1';
    });
    const seen: string[] = [];
    const t = await openTerminal(OPTIONS, { onData: (d) => seen.push(d), onClose: jest.fn() });
    native.__emit('onSshData', { id: 's1', data: b64('ls\r\n') });
    native.__emit('onSshData', { id: 'other', data: b64('not mine') });
    expect(t.id).toBe('s1');
    expect(seen.map((d) => Buffer.from(d, 'base64').toString())).toEqual(['root@OpenWrt:~# ', 'ls\r\n']);
    expect(native.sshOpen).toHaveBeenCalledWith(OPTIONS);
  });

  it('sends keyboard input as UTF-8, resizes, and reports the end once', async () => {
    native.sshOpen.mockResolvedValue('s2');
    native.sshWrite.mockResolvedValue(undefined);
    native.sshResize.mockResolvedValue(undefined);
    const onClose = jest.fn();
    const t = await openTerminal(OPTIONS, { onData: jest.fn(), onClose });
    await t.send('é\u0003');
    expect(native.sshWrite).toHaveBeenCalledWith('s2', b64('é\u0003'));
    await t.resize(100, 30);
    expect(native.sshResize).toHaveBeenCalledWith('s2', 100, 30);
    native.__emit('onSshClosed', { id: 's2', error: 'Broken pipe' });
    native.__emit('onSshClosed', { id: 's2', error: null });
    expect(onClose.mock.calls).toEqual([['Broken pipe']]);
  });

  it('stays quiet after closing it ourselves', async () => {
    native.sshOpen.mockResolvedValue('s3');
    native.sshClose.mockImplementation(async () => native.__emit('onSshClosed', { id: 's3', error: null }));
    const onClose = jest.fn();
    const onData = jest.fn();
    const t = await openTerminal(OPTIONS, { onData, onClose });
    await t.close();
    native.__emit('onSshData', { id: 's3', data: b64('late') });
    expect(native.sshClose).toHaveBeenCalledWith('s3');
    expect(onClose).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
  });

  it('turns native failures into NativeError codes', async () => {
    native.sshOpen.mockRejectedValue(
      Object.assign(new Error('the router refused the login'), { code: 'SSH_AUTH_FAILED' }),
    );
    const failure = openTerminal(OPTIONS, { onData: jest.fn(), onClose: jest.fn() });
    await expect(failure).rejects.toBeInstanceOf(NativeError);
    await expect(failure).rejects.toMatchObject({ code: 'SSH_AUTH_FAILED' });
  });
});

describe('one-off calls', () => {
  it('reads the host key and runs a command', async () => {
    native.sshHostKey.mockResolvedValue({ type: 'ssh-ed25519', fingerprint: 'SHA256:xyz' });
    await expect(readHostKey('192.168.1.1', 22)).resolves.toEqual({ type: 'ssh-ed25519', fingerprint: 'SHA256:xyz' });
    expect(native.sshHostKey).toHaveBeenCalledWith('192.168.1.1', 22, 10_000);

    native.sshExec.mockResolvedValue({ code: 0, stdout: 'ok\n', stderr: '' });
    await expect(runCommand(OPTIONS, 'echo ok')).resolves.toEqual({ code: 0, stdout: 'ok\n', stderr: '' });
    expect(native.sshExec).toHaveBeenCalledWith(OPTIONS, 'echo ok', 30_000);

    native.sshExec.mockRejectedValue(Object.assign(new Error('changed'), { code: 'SSH_HOST_KEY_CHANGED' }));
    await expect(runCommand(OPTIONS, 'id')).rejects.toMatchObject({ code: 'SSH_HOST_KEY_CHANGED' });
  });
});
