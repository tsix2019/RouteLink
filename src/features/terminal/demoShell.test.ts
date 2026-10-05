import { openDemoShell } from './demoShell';

const text = (chunks: string[]) => chunks.map((c) => Buffer.from(c, 'base64').toString('utf8')).join('');
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('demo shell', () => {
  it('greets with the banner and a prompt, answers commands and edits the line', async () => {
    const chunks: string[] = [];
    const shell = openDemoShell({ onData: (d) => chunks.push(d), onClose: jest.fn() });
    await settle();
    expect(text(chunks)).toContain('OpenWrt 24.10.8');
    expect(text(chunks).endsWith('root@RouteLink-Demo:~# ')).toBe(true);

    chunks.length = 0;
    await shell.send('upz\x7ftime\r');
    await settle();
    expect(text(chunks)).toContain('up 12 days');
    chunks.length = 0;
    await shell.send('nope\r');
    await settle();
    expect(text(chunks)).toContain('-ash: nope: not found');
  });

  it('ends on exit', async () => {
    const onClose = jest.fn();
    const shell = openDemoShell({ onData: jest.fn(), onClose });
    await shell.send('exit\r');
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
