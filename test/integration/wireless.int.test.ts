import { getRadioCapabilities, getRadios, radioChanges, scan } from '../../src/api/services/wireless';
import { stageAndApply } from '../../src/api/uci';
import { connect, waitFor } from './router';

// QEMU runs mac80211_hwsim radios; the Docker router has none and skips these.
describe('wireless', () => {
  const { conn } = connect();

  it('reads radios, changes a channel and scans', async () => {
    const radios = await getRadios(conn);
    if (radios.length === 0) {
      console.warn('no radios on this router: wireless checks skipped');
      return;
    }
    expect(radios.length).toBeGreaterThanOrEqual(2);
    const radio = radios.find((r) => r.band === '2.4G') ?? radios[0];
    const caps = await getRadioCapabilities(conn, radio.name);
    expect(caps.channels.length).toBeGreaterThan(0);

    const channel = radio.channel === '11' ? '6' : '11';
    const outcome = await stageAndApply(conn, radioChanges(radio, { channel }), { mode: 'rollback', timeoutSec: 30 });
    expect(['confirmed', 'applied']).toContain(outcome.status);
    expect((await getRadios(conn)).find((r) => r.name === radio.name)?.channel).toBe(channel);

    const ifname = (await getRadios(conn)).flatMap((r) => r.networks).find((n) => n.ifname)?.ifname;
    if (!ifname) return;
    let results: Awaited<ReturnType<typeof scan>> = [];
    expect(
      await waitFor(
        async () => {
          results = await scan(conn, ifname);
          return results.length > 0;
        },
        60_000,
        5_000,
      ),
    ).toBe(true);
  }, 180_000);
});
