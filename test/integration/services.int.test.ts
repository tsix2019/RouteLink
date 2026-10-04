import { kernelLog, systemLog } from '../../src/api/services/logs';
import { listServices, serviceAction } from '../../src/api/services/services';
import { connect, waitFor } from './router';

describe('services and logs', () => {
  const { conn } = connect();
  // dropbear: always running, and stopping it doesn't touch the HTTP connection we use.
  // (cron only runs when a crontab exists, which a fresh image doesn't have.)
  const dropbear = async () => (await listServices(conn)).find((s) => s.name === 'dropbear');

  it('stops and starts a service', async () => {
    const before = await dropbear();
    expect(before?.enabled).toBe(true);
    await serviceAction(conn, 'dropbear', 'stop');
    await serviceAction(conn, 'dropbear', 'start');
    // 23.05 lists init scripts without their state: there the calls succeeding is all we can check.
    if (before?.running === undefined) return;
    expect(before.running).toBe(true);
    await serviceAction(conn, 'dropbear', 'stop');
    expect(await waitFor(async () => (await dropbear())?.running === false, 15_000)).toBe(true);
    await serviceAction(conn, 'dropbear', 'start');
    expect(await waitFor(async () => (await dropbear())?.running === true, 15_000)).toBe(true);
  }, 90_000);

  it('reads the system log', async () => {
    expect((await systemLog(conn)).length).toBeGreaterThan(0);
  });

  it('reads the kernel log (containers may forbid it)', async () => {
    try {
      expect((await kernelLog(conn)).length).toBeGreaterThan(0);
    } catch (error) {
      expect(String(error)).toMatch(/Operation not permitted/);
    }
  });
});
