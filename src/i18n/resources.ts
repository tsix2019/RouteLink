import enAgent from './locales/en/agent.json';
import enAssistant from './locales/en/assistant.json';
import enCommon from './locales/en/common.json';
import enDevices from './locales/en/devices.json';
import enErrors from './locales/en/errors.json';
import enMore from './locales/en/more.json';
import enNetwork from './locales/en/network.json';
import enOnboarding from './locales/en/onboarding.json';
import enOverview from './locales/en/overview.json';
import enRisk from './locales/en/risk.json';
import enRouters from './locales/en/routers.json';
import enSettings from './locales/en/settings.json';
import enTerminal from './locales/en/terminal.json';
import enTraffic from './locales/en/traffic.json';
import enWireless from './locales/en/wireless.json';
import zhAgent from './locales/zh-CN/agent.json';
import zhAssistant from './locales/zh-CN/assistant.json';
import zhCommon from './locales/zh-CN/common.json';
import zhDevices from './locales/zh-CN/devices.json';
import zhErrors from './locales/zh-CN/errors.json';
import zhMore from './locales/zh-CN/more.json';
import zhNetwork from './locales/zh-CN/network.json';
import zhOnboarding from './locales/zh-CN/onboarding.json';
import zhOverview from './locales/zh-CN/overview.json';
import zhRisk from './locales/zh-CN/risk.json';
import zhRouters from './locales/zh-CN/routers.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhTerminal from './locales/zh-CN/terminal.json';
import zhTraffic from './locales/zh-CN/traffic.json';
import zhWireless from './locales/zh-CN/wireless.json';

export const namespaces = [
  'common',
  'onboarding',
  'routers',
  'overview',
  'devices',
  'wireless',
  'network',
  'more',
  'settings',
  'errors',
  'risk',
  'traffic',
  'agent',
  'terminal',
  'assistant',
] as const;

export type Namespace = (typeof namespaces)[number];

export const resources = {
  'zh-CN': {
    common: zhCommon,
    onboarding: zhOnboarding,
    routers: zhRouters,
    overview: zhOverview,
    devices: zhDevices,
    wireless: zhWireless,
    network: zhNetwork,
    more: zhMore,
    settings: zhSettings,
    errors: zhErrors,
    risk: zhRisk,
    traffic: zhTraffic,
    agent: zhAgent,
    terminal: zhTerminal,
    assistant: zhAssistant,
  },
  en: {
    common: enCommon,
    onboarding: enOnboarding,
    routers: enRouters,
    overview: enOverview,
    devices: enDevices,
    wireless: enWireless,
    network: enNetwork,
    more: enMore,
    settings: enSettings,
    errors: enErrors,
    risk: enRisk,
    traffic: enTraffic,
    agent: enAgent,
    terminal: enTerminal,
    assistant: enAssistant,
  },
} as const;
