import { DemoConnection } from '@/api/connection/demo/connection';
import { agentLatency, agentOutages, type OutageLog } from '@/api/services/agent-diag';
import { initI18n, i18n, type AppT } from '@/i18n';

import {
  availabilityText,
  exportFileName,
  latencyCsv,
  latencyText,
  msText,
  outagesCsv,
  pctText,
} from './latency-export';
import { latencyAxisMax } from './LatencyChart';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const t = () => i18n.t as unknown as AppT;
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeAll(() => {
  initI18n('en');
});

const log: OutageLog = {
  count: 2,
  totalSec: 380,
  availability: 99.95,
  outages: [
    {
      start: sec('2026-10-05T13:47:00+08:00'),
      end: sec('2026-10-05T13:50:20+08:00'),
      duration: 200,
      cause: 'redial',
      ongoing: false,
    },
    {
      start: sec('2026-10-05T20:00:00+08:00'),
      end: sec('2026-10-05T20:03:00+08:00'),
      duration: 180,
      cause: 'upstream',
      ongoing: true,
    },
  ],
};

it('formats the figures', () => {
  expect(msText(2.14)).toBe('2.1 ms');
  expect(msText(null)).toBe('—');
  expect(pctText(0.034)).toBe('0%');
  expect(pctText(1.25)).toBe('1.3%');
  expect(availabilityText(99.95)).toBe('99.95%');
  expect(availabilityText(99.9999)).toBe('99.99%');
  expect(availabilityText(100)).toBe('100%');
  expect(availabilityText(null)).toBe('—');
  expect(exportFileName('outages', sec('2026-10-05T00:00:00+08:00'))).toBe('routelink-outages-2026-10-05.csv');
});

it('exports outages as CSV, the ongoing one without an end', () => {
  const lines = outagesCsv(t(), log).replace('\uFEFF', '').split('\r\n');
  expect(lines[0]).toBe('Start,End,Duration (s),Cause');
  expect(lines[1]).toBe('2026-10-05 13:47,2026-10-05 13:50,200,Reconnect');
  expect(lines[2]).toBe('2026-10-05 20:00,Ongoing,180,Upstream unreachable');
});

it('exports the demo latency per target and point', async () => {
  const now = 1_800_000_000;
  const conn = new DemoConnection(2026, () => now * 1000, 0);
  const h = await agentLatency(conn, { start: now - 3_600, end: now, maxPoints: 60 });
  const lines = latencyCsv(t(), h).replace('\uFEFF', '').trimEnd().split('\r\n');
  expect(lines[0]).toBe('Time,Target,Average (ms),Max (ms),Loss (%)');
  expect(lines.length - 1).toBe(h.series.reduce((n, s) => n + s.points.length, 0));
  expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d,203\.0\.113\.1,[\d.]*,[\d.]*,[\d.]*$/);
});

it('writes a text summary with availability, targets and outages', async () => {
  const now = 1_800_000_000;
  const conn = new DemoConnection(2026, () => now * 1000, 0);
  const history = await agentLatency(conn, { start: now - 86_400, end: now, maxPoints: 24 });
  const text = latencyText(t(), 'en', { router: 'Home', range: 'Today', log, history });
  const lines = text.split('\n');
  expect(lines[0]).toBe('Home outages and latency (Today)');
  expect(lines[1]).toBe('Availability 99.95%, outages: 2, downtime 6m 20s');
  expect(lines[2]).toMatch(/^203\.0\.113\.1 \(WAN next hop\): avg [\d.]+ ms · max [\d.]+ ms · loss [\d.]+%$/);
  expect(text).toContain('Outages:\nOct 5, 2026, 13:47 – 13:50, 3m 20s, Reconnect');
  expect(text).toContain('– ongoing, 3m, Upstream unreachable');
  const empty = latencyText(t(), 'en', {
    router: 'Home',
    range: 'Today',
    log: await agentOutages(conn, { start: now - 60, end: now }),
  });
  expect(empty.split('\n').pop()).toBe('No outages');
});

it('scales the chart to the 95th percentile of the maxima', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({
    t: i * 60,
    avg: 5,
    max: i === 99 ? 2_000 : 12,
    loss: 0,
  }));
  expect(latencyAxisMax(points)).toBe(20);
  expect(latencyAxisMax([{ t: 0, avg: null, max: null, loss: null }])).toBe(1);
});
