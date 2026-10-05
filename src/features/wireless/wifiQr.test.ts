import { qrMatrix, wifiQrString } from './wifiQr';

const BS = String.fromCharCode(92);

describe('wifiQrString', () => {
  it('writes the Wi-Fi QR format phones understand', () => {
    expect(wifiQrString({ ssid: 'Home', key: 'secret123', encryption: 'psk2' })).toBe('WIFI:T:WPA;S:Home;P:secret123;;');
  });

  it('uses WPA for WPA3 and mixed modes, WEP for WEP', () => {
    for (const encryption of ['sae', 'sae-mixed', 'psk-mixed', 'psk']) {
      expect(wifiQrString({ ssid: 'a', key: 'b', encryption })).toContain('T:WPA;');
    }
    expect(wifiQrString({ ssid: 'a', key: 'b', encryption: 'wep-open' })).toContain('T:WEP;');
  });

  it('leaves the password out of open networks', () => {
    expect(wifiQrString({ ssid: 'CoffeeShop', key: 'ignored', encryption: 'none' })).toBe('WIFI:T:nopass;S:CoffeeShop;;');
  });

  it('marks hidden networks', () => {
    expect(wifiQrString({ ssid: 'h', key: 'k', encryption: 'psk2', hidden: true })).toBe('WIFI:T:WPA;S:h;P:k;H:true;;');
  });

  it('escapes the characters the format reserves', () => {
    const ssid = `a;b,c:d"e${BS}f`;
    expect(wifiQrString({ ssid, key: 'x', encryption: 'psk2' })).toBe(
      `WIFI:T:WPA;S:a${BS};b${BS},c${BS}:d${BS}"e${BS}${BS}f;P:x;;`,
    );
  });

  it('quotes values that would read as hexadecimal', () => {
    expect(wifiQrString({ ssid: 'cafe', key: '12345678', encryption: 'psk2' })).toBe(
      'WIFI:T:WPA;S:"cafe";P:"12345678";;',
    );
  });
});

describe('qrMatrix', () => {
  it('encodes Chinese network names as UTF-8 into a square matrix', () => {
    const m = qrMatrix(wifiQrString({ ssid: '我家的网络', key: 'routelink', encryption: 'psk2' }));
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // finder pattern corner
    expect(m[0][0]).toBe(true);
  });
});
