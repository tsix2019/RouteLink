import { Platform } from 'react-native';

import { launchUrlPath } from './launchUrl';

describe('launchUrlPath', () => {
  const original = Platform.OS;
  beforeAll(() => {
    Platform.OS = 'ios';
  });
  afterAll(() => {
    Platform.OS = original;
  });

  it('maps demo and self-test links to app paths', () => {
    expect(launchUrlPath(() => 'routelink://demo?lang=en&route=/devices')).toBe('/demo?lang=en&route=/devices');
    expect(launchUrlPath(() => 'routelink://selftest?http=x')).toBe('/selftest?http=x');
  });

  it('ignores anything else', () => {
    expect(launchUrlPath(() => undefined)).toBeNull();
    expect(launchUrlPath(() => 'routelink://add-router')).toBeNull();
    expect(launchUrlPath(() => 'https://example.com')).toBeNull();
  });
});
