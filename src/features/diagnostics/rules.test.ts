import { apUplink, dns, internet, overall, phoneWifi, stability, upstream, wan, wifiSecurity } from './rules';

const rtt = (avgMs: number, lossPct = 0) => ({ avgMs, jitterMs: 1, lossPct });

describe('segments', () => {
  it('phone to Wi-Fi', () => {
    expect(phoneWifi({ signal: -60, rtt: rtt(8) }).status).toBe('ok');
    expect(phoneWifi({ signal: -78, rtt: rtt(8) })).toEqual({
      status: 'warn',
      advice: ['move-closer', 'optimize-channel'],
    });
    expect(phoneWifi({ signal: -85, rtt: rtt(8) }).status).toBe('fail');
    expect(phoneWifi({ signal: -60, rtt: rtt(45) })).toEqual({ status: 'warn', advice: ['optimize-channel'] });
    expect(phoneWifi({ rtt: rtt(150) }).status).toBe('fail');
    expect(phoneWifi({ rtt: rtt(5, 20) }).status).toBe('fail');
  });

  it('AP uplinks', () => {
    expect(apUplink([]).status).toBe('skip');
    expect(apUplink([{ lossPct: 0 }, { lossPct: 5 }]).status).toBe('warn');
    expect(apUplink([{ lossPct: 0 }, { lossPct: 100 }])).toEqual({ status: 'fail', advice: ['check-ap-cable'] });
  });

  it('leaves out pings that could not run instead of counting them as loss', () => {
    expect(apUplink([{ lossPct: 0 }, { lossPct: null }]).status).toBe('ok');
    expect(apUplink([{ lossPct: null }])).toEqual({ status: 'skip', advice: [] });
    expect(upstream({ lossPct: null })).toEqual({ status: 'skip', advice: [] });
    expect(internet({ lossPct: null, http204: true })).toEqual({ status: 'ok', advice: [] });
    expect(internet({ lossPct: null, http204: false }).status).toBe('fail');
    expect(internet({ lossPct: null })).toEqual({ status: 'skip', advice: [] });
  });

  it('WAN', () => {
    expect(wan({ up: true, hasIp: true, redials24h: 0 }).status).toBe('ok');
    expect(wan({ up: true, hasIp: true, redials24h: 2 }).status).toBe('warn');
    expect(wan({ up: true, hasIp: false })).toEqual({ status: 'fail', advice: ['check-modem'] });
  });

  it('upstream gateway, DNS and internet', () => {
    expect(upstream({ lossPct: 0 }).status).toBe('ok');
    expect(upstream({ lossPct: 3 }).status).toBe('warn');
    expect(upstream({ lossPct: 100 }).status).toBe('fail');
    expect(
      dns(
        [
          { ok: true, ms: 40 },
          { ok: true, ms: 700 },
        ],
        true,
      ).status,
    ).toBe('warn');
    expect(
      dns(
        [
          { ok: false, ms: 40 },
          { ok: true, ms: 70 },
        ],
        true,
      ),
    ).toEqual({ status: 'fail', advice: ['change-dns'] });
    expect(dns([{ ok: false, ms: 40 }], false).advice).toEqual([]);
    expect(internet({ lossPct: 0, http204: true }).status).toBe('ok');
    expect(internet({ lossPct: 5, http204: true }).status).toBe('warn');
    expect(internet({ lossPct: 0, http204: false }).status).toBe('fail');
  });

  it('stability needs the plugin; security follows WF-4', () => {
    expect(stability(null).status).toBe('skip');
    expect(stability({ lossPct: 0.2, outages: 0 }).status).toBe('ok');
    expect(stability({ lossPct: 2, outages: 0 }).status).toBe('warn');
    expect(stability({ lossPct: 0, outages: 3 }).status).toBe('fail');
    expect(wifiSecurity('medium').status).toBe('warn');
    expect(wifiSecurity('danger').status).toBe('fail');
    expect(wifiSecurity(undefined).status).toBe('skip');
  });
});

it('headlines the nearest problem', () => {
  expect(overall({ wan: { status: 'warn', advice: [] }, dns: { status: 'fail', advice: [] } })).toEqual({
    status: 'fail',
    segment: 'dns',
  });
  expect(overall({ 'phone-wifi': { status: 'ok', advice: [] } })).toEqual({ status: 'ok' });
});
