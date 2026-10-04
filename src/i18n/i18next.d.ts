// Compile-time checking of translation keys: t('tabs.overview') / t('settings:language.title').
import 'i18next';

import type { resources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['zh-CN'];
  }
}
