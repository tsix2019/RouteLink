import type { History, Summary } from '@/api/services/agent';
import { initI18n, i18n, type AppT } from '@/i18n';

import { csvField, formatCsvTime, historyCsv, summaryCsv } from './csv';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const t = () => i18n.t as unknown as AppT;
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const summary: Summary = {
  startExact: sec('2026-10-05T00:00:00+08:00'),
  end: sec('2026-10-05T13:47:00+08:00'),
  granularity: 'minute',
  rx: 3_000,
  tx: 300,
  wanRx: 3_100,
  wanTx: 320,
  count: 2,
  truncated: false,
  devices: [
    { mac: 'AA:BB:CC:00:11:22', rx: 2_000, tx: 200 },
    { mac: 'AA:BB:CC:00:11:33', rx: 1_000, tx: 100 },
  ],
};

const history: History = {
  start: sec('2026-10-05T12:00:00+08:00'),
  end: sec('2026-10-05T12:03:00+08:00'),
  step: 60,
  tier: 'minute',
  points: [
    { t: sec('2026-10-05T12:00:00+08:00'), rx: 10, tx: 1 },
    { t: sec('2026-10-05T12:01:00+08:00'), rx: null, tx: null },
    { t: sec('2026-10-05T12:02:00+08:00'), rx: 30, tx: 3 },
  ],
};

beforeAll(async () => {
  initI18n('en');
  await i18n.changeLanguage('en');
});

describe('csvField', () => {
  it('quotes fields with commas, quotes or line breaks (RFC 4180)', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });
});

describe('formatCsvTime', () => {
  it('writes YYYY-MM-DD HH:mm in the phone’s zone (tests run in Asia/Shanghai)', () => {
    expect(formatCsvTime(sec('2026-10-05T00:05:00+08:00'))).toBe('2026-10-05 00:05');
  });
});

describe('summaryCsv', () => {
  const names = new Map([['AA:BB:CC:00:11:22', 'Kitchen, "Echo"']]);
  const range = { start: summary.startExact, end: summary.end };

  it('starts with a byte order mark so Excel reads UTF-8', () => {
    expect(summaryCsv(t(), summary, names, range).startsWith('\uFEFF')).toBe(true);
  });

  it('escapes names and falls back to the MAC', () => {
    const rows = summaryCsv(t(), summary, names, range).slice(1).split('\r\n');
    expect(rows[1].startsWith('"Kitchen, ""Echo""",AA:BB:CC:00:11:22,2000,200,2200,')).toBe(true);
    expect(rows[2].startsWith('AA:BB:CC:00:11:33,AA:BB:CC:00:11:33,1000,100,1100,')).toBe(true);
  });

  it('matches the full output', () => {
    expect(summaryCsv(t(), summary, names, range)).toMatchSnapshot();
  });
});

describe('historyCsv', () => {
  it('leaves missing data empty', () => {
    const rows = historyCsv(t(), history).slice(1).split('\r\n');
    expect(rows).toEqual([
      'Time,Download (bytes),Upload (bytes)',
      '2026-10-05 12:00,10,1',
      '2026-10-05 12:01,,',
      '2026-10-05 12:02,30,3',
      '',
    ]);
  });

  it('uses the language of the app for headers', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(historyCsv(t(), history)).toMatchSnapshot();
    await i18n.changeLanguage('en');
  });
});
