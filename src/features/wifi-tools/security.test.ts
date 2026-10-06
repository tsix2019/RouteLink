import type { WifiNetwork } from '@/api/services/wireless';

import {
  byRisk,
  checkNetwork,
  effectiveMfp,
  fixChanges,
  fixNeedsKey,
  generatePassword,
  parseWifiFeatures,
  passwordStrength,
  rateEncryption,
} from './security';

const net = (over: Partial<WifiNetwork> = {}): WifiNetwork => ({
  section: 'default_radio0',
  radio: 'radio0',
  ssid: 'Home',
  encryption: 'psk2',
  key: 'Tq8-vbn!Lp2x-Rw7',
  hidden: false,
  disabled: false,
  network: ['lan'],
  mode: 'ap',
  up: true,
  ...over,
});

describe('rateEncryption', () => {
  it.each([
    ['sae', undefined, 'high'],
    ['sae-mixed', undefined, 'high'],
    ['sae-mixed', '0', 'medium'],
    ['psk2', undefined, 'medium'],
    ['psk2+ccmp', undefined, 'medium'],
    ['psk2+tkip+ccmp', undefined, 'low'],
    ['owe', undefined, 'medium'],
    ['psk-mixed', undefined, 'low'],
    ['psk', undefined, 'low'],
    ['wep-open', undefined, 'danger'],
    ['none', undefined, 'danger'],
    ['wpa3', undefined, 'high'],
    ['wpa2', undefined, 'medium'],
  ])('%s (ieee80211w %s) → %s', (enc, w, level) => {
    expect(rateEncryption(enc, w)).toBe(level);
  });

  it('uses the hostapd defaults for management frame protection', () => {
    expect(effectiveMfp('sae')).toBe(2);
    expect(effectiveMfp('sae-mixed')).toBe(1);
    expect(effectiveMfp('psk2')).toBe(0);
    expect(effectiveMfp('psk2', '1')).toBe(1);
  });
});

describe('passwordStrength', () => {
  it.each([
    ['12345678', ['short', 'digits', 'common', 'keyboard']],
    ['13800138000', ['digits']],
    ['password', ['short', 'common', 'one-kind']],
    ['iloveyou2026', ['common']],
    ['qwertyuiop', ['common', 'keyboard', 'one-kind']],
    ['abcdefghijkl', ['keyboard', 'one-kind']],
    ['abcabcabcabc', ['repeat', 'one-kind']],
    ['MyHome-Wifi-2026', ['ssid']],
    ['bluefishwaterlamp', []],
  ])('%s', (pw, reasons) => {
    const r = passwordStrength(pw, 'MyHome');
    expect(r.reasons).toEqual(reasons);
    expect(r.strength).toBe(reasons.length ? 'weak' : 'medium');
  });

  it('grades by length and kinds of characters', () => {
    expect(passwordStrength('Tiger7lamp9x').strength).toBe('strong'); // 12, three kinds
    expect(passwordStrength('tiger7lamp9x').strength).toBe('medium'); // 12, two kinds
    expect(passwordStrength('Tiger7lamp9!').strength).toBe('strong'); // 12, four kinds
    expect(passwordStrength('tiger7lamp9xyz').strength).toBe('strong'); // 14, two kinds
    expect(passwordStrength('tiger7lamp').strength).toBe('medium'); // 10, two kinds
  });

  it('does not flag the SSID check on very short SSIDs', () => {
    expect(passwordStrength('tiger7lamp9xyz', 'x').reasons).toEqual([]);
  });
});

describe('generatePassword', () => {
  it('makes 16 characters of three kinds in groups of four, and rates strong', () => {
    let seed = 7;
    const random = (b: Uint8Array) => {
      for (let i = 0; i < b.length; i++) b[i] = (seed = (seed * 1103515245 + 12345) & 0xff);
      return b;
    };
    const pw = generatePassword(random);
    expect(pw).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
    expect(pw).not.toMatch(/[01lIoO]/);
    expect(passwordStrength(pw).strength).toBe('strong');
  });
});

describe('checkNetwork', () => {
  it('reports a strong WPA3 network without findings', () => {
    const r = checkNetwork(net({ encryption: 'sae-mixed' }), { sae: true });
    expect(r).toMatchObject({ level: 'high', fixes: [] });
    expect(r.findings).toEqual([{ kind: 'password', strength: 'strong', reasons: [] }]);
  });

  it('offers WPA3 when hostapd supports SAE, only advice when unknown', () => {
    expect(checkNetwork(net(), { sae: true }).fixes).toContain('upgrade-wpa3');
    expect(checkNetwork(net(), {}).fixes).toEqual(['enable-mfp']);
    expect(checkNetwork(net({ encryption: 'psk-mixed' }), {}).fixes[0]).toBe('upgrade-wpa2');
  });

  it('flags WPS, missing MFP, a weak key, an open guest network and hidden SSIDs', () => {
    const r = checkNetwork(
      net({ section: 'guest_radio0', network: ['guest'], key: 'Home12345', wps: true, hidden: true }),
      { sae: false },
    );
    expect(r.findings.map((f) => f.kind)).toEqual(['password', 'wps', 'mfp-off', 'guest-not-isolated', 'hidden']);
    expect(r.fixes).toEqual(['new-password', 'disable-wps', 'enable-mfp', 'isolate']);
  });

  it('rates open networks as danger and needs a password to fix them', () => {
    const open = net({ encryption: 'none', key: undefined });
    const r = checkNetwork(open, { sae: true });
    expect(r.level).toBe('danger');
    expect(r.fixes).toEqual(['upgrade-wpa3']);
    expect(fixNeedsKey(open, 'upgrade-wpa3')).toBe(true);
    expect(() => fixChanges(open, ['upgrade-wpa3'])).toThrow();
  });

  it('sorts worst first', () => {
    const levels = [{ level: 'high' }, { level: 'danger' }, { level: 'medium' }] as const;
    expect([...levels].sort(byRisk).map((l) => l.level)).toEqual(['danger', 'medium', 'high']);
  });
});

describe('fixChanges', () => {
  it('stages every chosen fix on the network section in one call', () => {
    const n = net({ wps: true });
    expect(fixChanges(n, ['upgrade-wpa3', 'disable-wps', 'new-password'], 'Abcd-Efgh-2345-Jkmn')).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'wireless',
          section: 'default_radio0',
          values: { encryption: 'sae-mixed', ieee80211w: '1', wps_pushbutton: '0', wps_label: '0', key: 'Abcd-Efgh-2345-Jkmn' },
        },
      },
    ]);
  });

  it('stages nothing when there is nothing to change', () => {
    expect(fixChanges(net(), ['disable-wps'])).toEqual([]);
  });
});

it('reads SAE support from luci getFeatures', () => {
  expect(parseWifiFeatures({ hostapd: { sae: true, owe: true } })).toEqual({ sae: true });
  expect(parseWifiFeatures({ hostapd: {} })).toEqual({ sae: undefined });
  expect(parseWifiFeatures(null)).toEqual({ sae: undefined });
});
