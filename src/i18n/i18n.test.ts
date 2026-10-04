import { getLocales } from 'expo-localization';

import { resolveLanguage } from './index';
import { namespaces, resources } from './resources';

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') out[`${prefix}${key}`] = value;
    else Object.assign(out, flatten(value, `${prefix}${key}.`));
  }
  return out;
}

const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe.each(namespaces)('namespace %s', (ns) => {
  const zh = flatten(resources['zh-CN'][ns] as Tree);
  const en = flatten(resources.en[ns] as Tree);

  it('has identical keys in zh-CN and en', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty strings', () => {
    expect([...Object.values(zh), ...Object.values(en)].filter((s) => !s.trim())).toEqual([]);
  });

  it('uses the same interpolation variables in both languages', () => {
    for (const key of Object.keys(zh)) {
      expect([key, vars(zh[key])]).toEqual([key, vars(en[key] ?? '')]);
    }
  });
});

describe('resolveLanguage', () => {
  const mocked = getLocales as jest.Mock;

  it('honours an explicit preference', () => {
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('zh-CN')).toBe('zh-CN');
  });

  it('maps any Chinese system locale to zh-CN', () => {
    mocked.mockReturnValue([{ languageCode: 'zh', languageTag: 'zh-Hant-TW' }]);
    expect(resolveLanguage('system')).toBe('zh-CN');
  });

  it('falls back to English for other locales', () => {
    mocked.mockReturnValue([{ languageCode: 'fr', languageTag: 'fr-FR' }]);
    expect(resolveLanguage('system')).toBe('en');
    mocked.mockReturnValue([]);
    expect(resolveLanguage('system')).toBe('en');
  });
});
