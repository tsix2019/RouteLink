import type { UciSection } from '../uci';
import { parseDnsLog, parseNotifyStatus, parseQuotas } from './agent-control';
import {
  channelChanges,
  channelEdited,
  dnsChanges,
  limitChanges,
  parseRules,
  quotaChanges,
  rulesOf,
  validateChannel,
  validateLimit,
  validateQuota,
  type LimitRule,
  type NotifyChannel,
  type QuotaRule,
} from './agent-rules';

const sec = (name: string, type: string, index: number, values: Record<string, string | string[]>): UciSection => ({
  '.name': name,
  '.type': type,
  '.anonymous': !['dns', 'notify'].includes(name),
  '.index': index,
  ...values,
});

const config = {
  main: sec('main', 'routelink', 0, {}),
  cfg1: sec('cfg1', 'limit', 1, {
    mac: 'aa-bb-cc-dd-ee-01',
    download: '8000',
    upload: '2000',
    weekdays: ['mon', 'fri', 'xyz'],
    start_time: '20:00',
    stop_time: '23:00',
  }),
  cfg2: sec('cfg2', 'quota', 2, {
    mac: 'AA:BB:CC:DD:EE:02',
    period: 'week',
    reset_day: '1',
    limit_mb: '102400',
    action: 'limit',
    limit_download: '1000',
  }),
  dns: sec('dns', 'dns', 3, { enabled: '1', keep_days: '3' }),
  cfg3: sec('cfg3', 'notify', 4, { type: 'telegram', token: 't', chat_id: '-100', events: ['quota', 'nope'] }),
  notify: sec('notify', 'notify_settings', 5, { lang: 'en' }),
};

describe('parseRules', () => {
  it('reads limits, quotas, DNS, channels and the message language', () => {
    const r = parseRules(config);
    expect(r.limits).toEqual([
      {
        section: 'cfg1',
        mac: 'AA:BB:CC:DD:EE:01',
        enabled: true,
        download: 8000,
        upload: 2000,
        weekdays: ['mon', 'fri'],
        start: '20:00',
        stop: '23:00',
      },
    ]);
    expect(r.quotas[0]).toMatchObject({ period: 'week', limitMb: 102400, action: 'limit', limitDownload: 1000 });
    expect(r.dns).toEqual({ enabled: true, keepDays: 3, maxRecords: 100_000 });
    expect(r.channels).toEqual([expect.objectContaining({ type: 'telegram', chatId: '-100', events: ['quota'] })]);
    expect(r.lang).toBe('en');
    expect(rulesOf(r, 'aa:bb:cc:dd:ee:02').quota?.section).toBe('cfg2');
  });

  it('defaults DNS logging to off when the section is missing', () => {
    expect(parseRules({}).dns).toEqual({ enabled: false, keepDays: 7, maxRecords: 100_000 });
  });
});

describe('validation', () => {
  const limit: LimitRule = { mac: 'AA:BB:CC:DD:EE:01', enabled: true, download: 1000, upload: 0, weekdays: [] };
  it('limits', () => {
    expect(validateLimit(limit)).toEqual([]);
    expect(validateLimit({ ...limit, download: 0 })).toEqual(['rate']);
    expect(validateLimit({ ...limit, start: '20:00' })).toEqual(['time']);
    expect(validateLimit({ ...limit, start: '25:00', stop: '01:00' })).toEqual(['time']);
    expect(validateLimit({ ...limit, mac: 'x' })).toEqual(['mac']);
  });

  it('needs a day picked when the limit only applies at some times', () => {
    const timed = { ...limit, start: '20:00', stop: '23:00' };
    // Empty weekdays is "every day" in UCI; nothing ticked in the form must not turn into that.
    expect(validateLimit(timed, { pickedDays: 0 })).toEqual(['weekdays']);
    expect(validateLimit(timed, { pickedDays: 2 })).toEqual([]);
    expect(validateLimit(timed, { pickedDays: 7 })).toEqual([]);
    expect(validateLimit(timed)).toEqual([]);
  });

  const quota: QuotaRule = {
    mac: 'AA:BB:CC:DD:EE:01',
    enabled: true,
    period: 'month',
    resetDay: 1,
    limitMb: 1024,
    direction: 'total',
    action: 'block',
  };
  it('quotas', () => {
    expect(validateQuota(quota)).toEqual([]);
    expect(validateQuota({ ...quota, resetDay: 31 })).toEqual(['reset-day']);
    expect(validateQuota({ ...quota, period: 'week', resetDay: 8, limitMb: 0 })).toEqual(['limit-mb', 'reset-day']);
    expect(validateQuota({ ...quota, action: 'limit' })).toEqual(['limit-rate']);
  });

  const channel: NotifyChannel = {
    type: 'webhook',
    enabled: true,
    name: '',
    url: 'https://hooks.example/x',
    template: '',
    token: '',
    chatId: '',
    secret: '',
    events: ['device_new'],
  };
  it('push channels', () => {
    expect(validateChannel(channel)).toEqual([]);
    expect(validateChannel({ ...channel, url: 'hooks' })).toEqual(['url']);
    expect(validateChannel({ ...channel, type: 'telegram', url: '', chatId: 'x' })).toEqual(['token', 'chat-id']);
    expect(validateChannel({ ...channel, type: 'serverchan', url: '', token: 'SCT1', events: [] })).toEqual(['events']);
  });

  it('tells a push channel with unsaved edits from the saved one', () => {
    const saved: NotifyChannel = { ...channel, section: 'cfg01', events: ['device_new', 'quota'] };
    expect(channelEdited(saved, { ...saved })).toBe(false);
    // Saving trims and the event order does not matter.
    expect(channelEdited(saved, { ...saved, url: ' https://hooks.example/x ', events: ['quota', 'device_new'] })).toBe(
      false,
    );
    expect(channelEdited(saved, { ...saved, token: 'new' })).toBe(true);
    expect(channelEdited(saved, { ...saved, events: ['device_new'] })).toBe(true);
    expect(channelEdited(saved, { ...saved, enabled: false })).toBe(true);
  });
});

describe('changes', () => {
  it('adds a new limit, and clears options on an existing one', () => {
    const rule: LimitRule = { mac: 'aa:bb:cc:dd:ee:09', enabled: true, download: 500, upload: 0, weekdays: [] };
    expect(limitChanges(rule)).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'routelink',
          type: 'limit',
          values: { mac: 'AA:BB:CC:DD:EE:09', enabled: '1', download: '500', upload: '0' },
        },
      },
    ]);
    const existing = parseRules(config).limits[0];
    const calls = limitChanges({
      ...existing,
      weekdays: [...(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)],
      start: undefined,
      stop: undefined,
    });
    expect(calls.map((c) => [c.method, c.params?.option])).toEqual([
      ['set', undefined],
      ['delete', 'weekdays'],
      ['delete', 'start_time'],
      ['delete', 'stop_time'],
    ]);
  });

  it('quota, DNS and channel sections', () => {
    const q = parseRules(config).quotas[0];
    expect(quotaChanges({ ...q, action: 'block' }).map((c) => [c.method, c.params?.option])).toEqual([
      ['set', undefined],
      ['delete', 'limit_download'],
      ['delete', 'limit_upload'],
    ]);
    expect(dnsChanges({}, { enabled: true, keepDays: 7, maxRecords: 1000 })[0]).toMatchObject({
      method: 'add',
      params: { type: 'dns', name: 'dns' },
    });
    expect(channelChanges(parseRules(config).channels[0])[0]).toMatchObject({
      method: 'set',
      params: { section: 'cfg3', values: { type: 'telegram', events: ['quota'] } },
    });
  });
});

describe('plugin replies', () => {
  it('quotas, DNS log and push status', () => {
    expect(
      parseQuotas({
        quotas: [{ section: 'cfg2', mac: 'aa:bb:cc:dd:ee:02', limit: 100, used: 85, pct: 85, state: 'warned' }],
      }),
    ).toEqual([
      expect.objectContaining({ mac: 'AA:BB:CC:DD:EE:02', state: 'warned', action: 'block', period: 'month' }),
    ]);
    expect(
      parseDnsLog({
        count: 1,
        records: [
          { ts: 1, mac: 'aa:bb:cc:dd:ee:02', name: 'a.example', type: 'A', rcode: 'NOERROR', answers: ['1.2.3.4'] },
        ],
      }).records[0],
    ).toMatchObject({ answers: ['1.2.3.4'] });
    expect(
      parseNotifyStatus({ pending: 2, channels: [{ section: 'cfg3', last_error: 'HTTP 401', last_error_ts: 5 }] }),
    ).toEqual({
      pending: 2,
      channels: [{ section: 'cfg3', lastOk: 0, lastError: 'HTTP 401', lastErrorTs: 5 }],
    });
  });
});
