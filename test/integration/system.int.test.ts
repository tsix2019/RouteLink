import { getDeviceCounters, getInterfaces, pickWan } from '../../src/api/services/network';
import { getSystem, getTemperature } from '../../src/api/services/system';
import { detectCapabilities } from '../../src/api/capabilities';
import { connect } from './router';

describe('system', () => {
  const { conn } = connect();

  it('reads board, release, memory and load', async () => {
    const s = await getSystem(conn);
    expect(s.firmware).toMatch(/\d+\.\d+/);
    expect(s.memory.total).toBeGreaterThan(0);
    expect(s.cpuCores ?? 1).toBeGreaterThanOrEqual(1);
    expect(s.uptimeSec).toBeGreaterThan(0);
  });

  it('lists interfaces with LAN and a WAN', async () => {
    const ifs = await getInterfaces(conn);
    expect(ifs.find((i) => i.name === 'lan')?.up).toBe(true);
    expect(pickWan(ifs)).toBeDefined();
  });

  it('reads device counters for the LAN device', async () => {
    const ifs = await getInterfaces(conn);
    const lan = ifs.find((i) => i.name === 'lan');
    const counters = await getDeviceCounters(conn);
    expect(lan?.device && counters[lan.device]).toBeTruthy();
  });

  it('detects capabilities without throwing; temperature may be missing', async () => {
    const caps = await detectCapabilities(conn);
    expect(caps.services).toEqual({ status: 'ok' });
    const t = await getTemperature(conn);
    expect(t === null || typeof t === 'number').toBe(true);
  });
});
