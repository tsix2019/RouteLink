import {
  DemoApConnection,
  DemoConnection,
  DEMO_AP_ID,
  DEMO_AP_NAME,
  DEMO_ROUTER_ID,
} from '@/api/connection/demo/connection';
import { initI18n, i18n, type AppT } from '@/i18n';

import { runDiagnosis, type SegmentResult } from './diagnose';
import { prepareDiagnosis } from './prepare';
import { ADVICE_HREF, diagnosisText, headline, round1, segmentFacts } from './present';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const NOW = 1_800_000_000_000;
const t = () => i18n.t as unknown as AppT;

beforeAll(() => {
  initI18n('en');
});

async function demoRun(plugin = true) {
  const gateway = new DemoConnection(2026, () => NOW, 0);
  const ap = new DemoApConnection(gateway);
  const members = [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: ap }];
  const { input } = await prepareDiagnosis({
    gateway,
    gatewayRef: { id: DEMO_ROUTER_ID, name: 'Demo' },
    members,
    phoneIp: async () => null,
    wait: async () => undefined,
  });
  return runDiagnosis({ ...input, plugin, now: () => NOW }, () => undefined);
}

it('rounds to one decimal only below ten', () => {
  expect(round1(0.44)).toBe('0.4');
  expect(round1(12.5)).toBe('13');
  expect(round1(3)).toBe('3');
});

it('describes each segment of a demo run in plain lines', async () => {
  const results = await demoRun();
  const by = Object.fromEntries(results.map((r) => [r.segment, r]));
  const facts = (s: SegmentResult['segment']) => segmentFacts(t(), 'en', by[s], { plugin: true });
  // The link rate comes in kbit/s.
  expect(facts('phone-wifi')[0]).toMatch(/^Signal at the access point -\d+ dBm · .+ · link rate \d{2,4} Mbps · /);
  expect(facts('phone-wifi')[1]).toMatch(/^Round trip to the router \d+ ms, jitter \d+ ms$/);
  expect(facts('ap-uplink')[0]).toBe(`Loss pinging the gateway: ${DEMO_AP_NAME}: 0%`);
  expect(facts('wan')).toEqual([expect.stringMatching(/^PPPoE · [\d.]+ · up /), 'Reconnects in the last 24 h: 0']);
  expect(facts('upstream')[0]).toMatch(/^Next hop [\d.]+ · average [\d.]+ ms$/);
  expect(facts('dns')[0]).toMatch(/^Lookups: www\.baidu\.com \d+ ms, www\.apple\.com \d+ ms$/);
  expect(facts('internet')).toEqual([expect.stringMatching(/^Loss pinging public addresses 0%/), 'HTTP check passed']);
  expect(facts('stability')[0]).toMatch(/^Last 24 h: [\d.]+% loss, outages: 1$/);
  expect(facts('wifi-security')[0]).toMatch(/^Weakest network: /);
});

it('says why the stability check was skipped', async () => {
  const results = await demoRun(false);
  const stability = results.find((r) => r.segment === 'stability')!;
  expect(stability.verdict.status).toBe('skip');
  expect(segmentFacts(t(), 'en', stability, { plugin: false })).toEqual(['Needs the RouteLink plugin']);
  expect(segmentFacts(t(), 'en', stability, { plugin: true })).toEqual(['The plugin returned no latency data']);
});

it('heads the result with the nearest problem', () => {
  const r = (segment: SegmentResult['segment'], status: 'ok' | 'warn' | 'fail' | 'skip'): SegmentResult => ({
    segment,
    verdict: { status, advice: [] },
    facts: {},
  });
  expect(headline(t(), [], true)).toEqual({ status: 'running', title: 'Checking…' });
  expect(headline(t(), [r('phone-wifi', 'ok'), r('ap-uplink', 'skip')], false).title).toBe('Everything looks fine');
  expect(headline(t(), [r('phone-wifi', 'warn'), r('wan', 'fail')], true)).toEqual({
    status: 'fail',
    segment: 'wan',
    title: 'The problem is at: Gateway WAN',
  });
  expect(headline(t(), [r('phone-wifi', 'ok'), r('dns', 'warn')], false).title).toBe('Worth a look: DNS');
});

it('shares the result as text with facts and advice', async () => {
  const results = await demoRun();
  const text = diagnosisText(t(), 'en', { router: 'Home', at: NOW / 1000, results, plugin: true });
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^RouteLink network diagnosis · Home · /);
  expect(lines[1]).toBe('Worth a look: Recent stability');
  expect(lines[3]).toMatch(/^\[OK\] Phone to Wi-Fi: Signal at the access point/);
  expect(text).toContain('[OK] Gateway WAN: PPPoE');
  expect(text).toContain('[Warning] Recent stability: ');
  expect(text).toContain('  · See the outage log, useful as evidence for your provider');
});

it('links the advice that has a screen', () => {
  expect(ADVICE_HREF['outage-log']).toBe('/network/diagnostics/latency');
  expect(ADVICE_HREF['optimize-channel']).toBe('/wireless/tools/channels');
  expect(ADVICE_HREF['check-modem']).toBeUndefined();
});
