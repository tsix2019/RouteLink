import { useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useT } from '@/i18n';
import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * iOS: the system tab bar, which is Liquid Glass on iOS 26 and shrinks while scrolling down.
 * SDK 58 renames the import to 'expo-router/native-tabs' — only this file needs to change.
 */
export default function AppTabs() {
  const t = useT();
  const { colors } = useTheme();
  // Segments are ['(tabs)', '<tab>', ...page]; the bar only shows on a tab's root page.
  const segments = useSegments() as string[];
  const isTabRoot = segments.filter((s) => s !== 'index').length <= 2;
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.accent} hidden={!isTabRoot}>
      <NativeTabs.Trigger name="overview">
        <NativeTabs.Trigger.Label>{t('tabs.overview')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gauge.with.dots.needle.33percent', selected: 'gauge.with.dots.needle.67percent' }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="devices">
        <NativeTabs.Trigger.Label>{t('tabs.devices')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="laptopcomputer.and.iphone" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wireless">
        <NativeTabs.Trigger.Label>{t('tabs.wireless')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="wifi" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="network">
        <NativeTabs.Trigger.Label>{t('tabs.network')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="network" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>{t('tabs.more')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
