import { lookupVendor } from './oui';

describe('lookupVendor', () => {
  it('finds well-known vendors', () => {
    expect(lookupVendor('00:1A:11:12:34:56')).toBe('Google');
    expect(lookupVendor('3c:2e:f9:00:00:01')).toBe('Apple');
    expect(lookupVendor('28-6F-B9-00-00-01')).toBe('Nokia Shanghai Bell');
  });

  it('returns null for randomized (private) addresses', () => {
    expect(lookupVendor('DA:A1:19:00:00:01')).toBeNull();
  });

  it('returns null for unknown prefixes and malformed input', () => {
    expect(lookupVendor('0C:00:00:00:00:00')).toBeNull();
    expect(lookupVendor('zz')).toBeNull();
  });
});
