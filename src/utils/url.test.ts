import { normalizeBaseUrl } from './url';

describe('normalizeBaseUrl', () => {
  it.each([
    ['192.168.1.1', 'http://192.168.1.1'],
    ['https://router.lan/', 'https://router.lan'],
    ['http://10.0.2.2:18080//', 'http://10.0.2.2:18080'],
    ['  HTTP://Router.LAN  ', 'http://router.lan'],
    ['openwrt.lan:8080', 'http://openwrt.lan:8080'],
    ['https://192.168.1.1/cgi-bin/luci/', 'https://192.168.1.1'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it.each(['', '   ', 'ftp://x', 'http://', 'http://bad host'])('rejects %p', (input) => {
    expect(() => normalizeBaseUrl(input)).toThrow();
  });
});
