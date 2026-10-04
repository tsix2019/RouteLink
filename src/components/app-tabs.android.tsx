import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { useT } from '@/i18n';
import { BlurTarget, BlurTargetProvider } from '@/ui/glass/BlurTarget';
import { GlassTabBar, GlassTabButton } from '@/ui/tabs/GlassTabBar';
import type { IconName } from '@/ui/Icon';

const TABS: { name: string; href: '/overview' | '/devices' | '/wireless' | '/network' | '/more'; icon: IconName; label: 'tabs.overview' | 'tabs.devices' | 'tabs.wireless' | 'tabs.network' | 'tabs.more' }[] = [
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
  return (
    <BlurTargetProvider>
      <Tabs style={styles.flex}>
        <BlurTarget style={styles.flex}>
          <TabSlot />
        </BlurTarget>
        <TabList asChild>
          <GlassTabBar>
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
