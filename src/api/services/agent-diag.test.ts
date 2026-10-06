import { FixtureConnection, ok } from '../../../test/fixture-connection';
import {
  agentLatency,
  lossPct,
  parseLatency,
  parseOutages,
  parseSpeedHistory,
  parseSpeedRun,
  startRouterSpeedtest,
} from './agent-diag';

describe('parseLatency', () => {
  it('reads targets, series with gaps and the summary', () => {
    const h = parseLatency({
      start: 100,
      end: 220,
      step: 60,
      tier: 'minute',
      targets: [
        { id: 0, ip: '100.64.0.1', kind: 'gateway' },
        { id: 1, ip: '223.5.5.5', kind: 'odd' },
      ],
      series: [{ target: 0, points: [[120, 2.1, 9.5, 0], [180, null, null, null], 'junk'] }],
      summary: [{ target: 0, sent: 12, lost: 3, avg_ms: 2.1, max_ms: 9.5 }],
    });
    expect(h.targets[1].kind).toBe('custom');
    expect(h.series[0].points).toEqual([
      { t: 120, avg: 2.1, max: 9.5, loss: 0 },
      { t: 180, avg: null, max: null, loss: null },
    ]);
    expect(lossPct(h.summary[0])).toBe(25);
    expect(lossPct({ sent: 0, lost: 0 })).toBeNull();
  });

  it('sends only the parameters that are set', async () => {
    const conn = new FixtureConnection().override('routelink.latency', ok({ series: [] }));
    await agentLatency(conn, { start: 1, end: 2, target: '1.1.1.1' });
    expect(conn.calls.at(-1)!.params).toEqual({ start: 1, end: 2, target: '1.1.1.1' });
  });
});

it('parses outages with unknown causes as upstream', () => {
  expect(
    parseOutages({
      count: 2,
      total_sec: 380,
      availability: 99.95,
      outages: [
        { start: 10, end: 210, duration: 200, cause: 'redial', ongoing: false },
        { start: 300, end: 480, duration: 180, cause: '?', ongoing: true },
      ],
    }),
  ).toEqual({
    count: 2,
    totalSec: 380,
    availability: 99.95,
    outages: [
      { start: 10, end: 210, duration: 200, cause: 'redial', ongoing: false },
      { start: 300, end: 480, duration: 180, cause: 'upstream', ongoing: true },
    ],
  });
});

describe('router speed test', () => {
  it('parses a run and the history', () => {
    expect(parseSpeedRun({ id: 3, running: true, phase: 'download', progress: 1.4 })).toEqual({
      id: 3,
      running: true,
      phase: 'download',
      progress: 1,
      result: undefined,
      error: undefined,
    });
    const h = parseSpeedHistory({
      running: false,
      results: [{ id: 2, ts: 5, server: 'cf', latency_ms: 12.3, jitter_ms: 1.1, down_bps: 9e8, up_bps: 4e7 }],
    });
    expect(h.results[0]).toMatchObject({ latencyMs: 12.3, downBps: 9e8, error: undefined });
  });

  it('reports a run that is already going', async () => {
    const conn = new FixtureConnection().override('routelink.speedtest_start', ok({ id: 7, already: true }));
    await expect(startRouterSpeedtest(conn)).resolves.toEqual({ id: 7, already: true });
  });
});
