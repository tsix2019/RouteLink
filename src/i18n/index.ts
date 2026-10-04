import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { namespaces, resources } from './resources';

export type AppLanguage = 'zh-CN' | 'en';
export type LanguagePreference = 'system' | AppLanguage;

/** Any Chinese system locale (Simplified or Traditional) maps to zh-CN; everything else to English. */
export function resolveLanguage(pref: LanguagePreference): AppLanguage {
  if (pref !== 'system') return pref;
  return getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en';
}

export const i18n = createInstance();

export function initI18n(pref: LanguagePreference = 'system') {
  if (i18n.isInitialized) return i18n;
  i18n.use(initReactI18next).init({
    resources,
    lng: resolveLanguage(pref),
    fallbackLng: 'en',
    ns: [...namespaces],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** Applies immediately; no restart needed. */
export function setLanguage(pref: LanguagePreference) {
  return i18n.changeLanguage(resolveLanguage(pref));
}

export const currentLanguage = (): AppLanguage => (i18n.language === 'zh-CN' ? 'zh-CN' : 'en');
