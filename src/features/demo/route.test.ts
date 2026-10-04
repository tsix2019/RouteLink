import { demoLanguage, safeDemoRoute } from './route';

describe('safeDemoRoute', () => {
  it.each([
    [undefined, '/overview'],
    ['/devices', '/devices'],
    ['wireless', '/wireless'],
    ['/(tabs)/network', '/network'],
    ['/more/routers', '/more/routers'],
    ['/device/AA:BB', '/overview'],
    ['/reboot', '/overview'],
    ['https://evil.example', '/overview'],
    ['/overview/../reboot', '/overview'],
    ['/overview/%2E%2E/reboot', '/overview'],
  ])('%s → %s', (input, expected) => {
    expect(safeDemoRoute(input)).toBe(expected);
  });

  it('maps languages', () => {
    expect(demoLanguage('zh')).toBe('zh-CN');
    expect(demoLanguage('en')).toBe('en');
    expect(demoLanguage('fr')).toBeUndefined();
  });
});
