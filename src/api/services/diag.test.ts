import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { runTool } from './diag';

describe('runTool', () => {
  it('execs the tool with a long timeout and parses stdout and stderr together', async () => {
    const conn = new FixtureConnection().override(
      'file.exec',
      ok({
        code: 0,
        stderr: 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 46 byte packets\n',
        stdout: ' 1  192.168.8.1  0.5 ms\n 2  1.1.1.1  9.1 ms\n',
      }),
    );
    let t = 0;
    const r = await runTool(conn, 'traceroute', '1.1.1.1', {}, () => (t += 250));
    expect(conn.calls.at(-1)).toMatchObject({
      object: 'file',
      method: 'exec',
      params: { command: '/bin/traceroute', params: ['-n', '-w', '1', '-q', '1', '-m', '20', '1.1.1.1'] },
    });
    expect(r).toMatchObject({ tool: 'traceroute', code: 0, ms: 250 });
    expect(r.summary).toHaveLength(2);
  });

  it('refuses targets that are not host names or addresses', async () => {
    await expect(runTool(new FixtureConnection(), 'ping', '-f 1.1.1.1')).rejects.toThrow('target-invalid');
  });
});
