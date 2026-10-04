import { isRandomizedMac, normalizeMac } from './mac';

describe('normalizeMac', () => {
  it.each([
    ['aa-bb-cc-00-11-22', 'AA:BB:CC:00:11:22'],
    ['aabb.cc00.1122', 'AA:BB:CC:00:11:22'],
    ['AA:BB:CC:00:11:22', 'AA:BB:CC:00:11:22'],
    ['aabbcc001122', 'AA:BB:CC:00:11:22'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMac(input)).toBe(expected);
  });

  it('returns null for invalid input', () => {
    expect(normalizeMac('xyz')).toBeNull();
    expect(normalizeMac('AA:BB:CC:00:11')).toBeNull();
    expect(normalizeMac('')).toBeNull();
  });
});

describe('isRandomizedMac', () => {
  it('detects locally administered addresses', () => {
    expect(isRandomizedMac('DA:A1:19:00:00:01')).toBe(true);
    expect(isRandomizedMac('02:00:00:00:00:01')).toBe(true);
    expect(isRandomizedMac('00:1A:11:00:00:01')).toBe(false);
    expect(isRandomizedMac('F4:F5:D8:00:00:01')).toBe(false);
  });
});
