import { useSegments } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { useT } from '@/i18n';
import { BlurTarget, BlurTargetProvider } from '@/ui/glass/BlurTarget';
import { GlassTabBar, GlassTabButton, setTabBarVisible } from '@/ui/tabs/GlassTabBar';
import type { IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';

const TABS: {
  name: string;
  href: '/overview' | '/devices' | '/wireless' | '/network' | '/more';
  icon: IconName;
  label: 'tabs.overview' | 'tabs.devices' | 'tabs.wireless' | 'tabs.network' | 'tabs.more';
}[] = [
  { name: 'overview', href: '/overview', icon: 'overview', label: 'tabs.overview' },
  { name: 'devices', href: '/devices', icon: 'devices', label: 'tabs.devices' },
  { name: 'wireless', href: '/wireless', icon: 'wifi', label: 'tabs.wireless' },
  { name: 'network', href: '/network', icon: 'network', label: 'tabs.network' },
  { name: 'more', href: '/more', icon: 'more', label: 'tabs.more' },
];

/**
 * Android: headless tabs with a floating glass bar. The screens sit inside the blur target and the bar
 * outside it, so the bar blurs the content scrolling underneath without sampling itself.
 */
export default function AppTabs() {
  const t = useT();
  const { colors } = useTheme();
  // Segments are ['(tabs)', '<tab>', ...page]; a tab's root page is 'index' or has no further segment.
  const segments = useSegments() as string[];
  const isTabRoot = segments.filter((s) => s !== 'index').length <= 2;
  useEffect(() => {
    setTabBarVisible(isTabRoot);
    return () => setTabBarVisible(true);
  }, [isTabRoot]);
  return (
    <BlurTargetProvider>
      <Tabs style={styles.flex}>
        {/* The blur samples this view, so it carries the page background itself. */}
        <BlurTarget style={[styles.flex, { backgroundColor: colors.background }]}>
          <TabSlot />
        </BlurTarget>
        {/* TabList stays mounted (it registers the triggers); only its bar is hidden. */}
        <TabList asChild>
          <GlassTabBar hidden={!isTabRoot}>
            {TABS.map((tab, index) => (
              <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
                <GlassTabButton icon={tab.icon} label={t(tab.label)} index={index} />
              </TabTrigger>
            ))}
          </GlassTabBar>
        </TabList>
      </Tabs>
    </BlurTargetProvider>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
