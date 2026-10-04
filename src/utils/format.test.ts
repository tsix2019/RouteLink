import { formatBitRate, formatBytes, formatDuration, formatPercent, protoLabel } from './format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [150 * 1024 ** 2, '150 MB'],
    [3 * 1024 ** 4, '3.0 TB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('treats negative and non-finite input as zero', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatBitRate', () => {
  it.each([
    [0, '0 bps'],
    [999, '999 bps'],
    [1_500, '1.5 Kbps'],
    [12_300_000, '12.3 Mbps'],
    [250_000_000, '250 Mbps'],
    [1_200_000_000, '1.2 Gbps'],
  ])('%d → %s', (bps, expected) => {
    expect(formatBitRate(bps)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'en', '0s'],
    [59, 'en', '59s'],
    [3_660, 'en', '1h 1m'],
    [273_600, 'en', '3d 4h'],
    [90_061, 'en', '1d 1h'],
    [59, 'zh-CN', '59 秒'],
    [3_660, 'zh-CN', '1 小时 1 分钟'],
    [273_600, 'zh-CN', '3 天 4 小时'],
  ] as const)('%d (%s) → %s', (sec, lang, expected) => {
    expect(formatDuration(sec, lang)).toBe(expected);
  });
});

describe('formatPercent', () => {
  it.each([
    [0, '0%'],
    [0.423, '42%'],
    [1, '100%'],
    [1.7, '100%'],
  ])('%d → %s', (ratio, expected) => {
    expect(formatPercent(ratio)).toBe(expected);
  });
});

describe('protoLabel', () => {
  it('spells protocols the usual way', () => {
    expect(protoLabel('pppoe', 'en')).toBe('PPPoE');
    expect(protoLabel('static', 'zh-CN')).toBe('静态地址');
    expect(protoLabel('static', 'en')).toBe('Static');
    expect(protoLabel('dhcp', 'zh-CN')).toBe('DHCP');
    expect(protoLabel('batadv', 'en')).toBe('batadv');
  });
});
