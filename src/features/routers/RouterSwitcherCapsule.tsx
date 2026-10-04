import { skipToken, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { StatusDot, type Status } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';

import { useActiveRouter } from './ActiveRouterProvider';

const MAX_NAME = 14;

/** Header capsule on every tab root: current router, its status, and a tap to switch. */
export function RouterSwitcherCapsule() {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const { router: active, status } = useActiveRouter();
  // Observe the cached system query without fetching: its state is the router's reachability.
  const system = useQuery({ queryKey: [active?.id ?? 'none', 'system'], queryFn: skipToken });

  const name = active ? (active.isDemo ? t('demoRouter') : active.name) : t('routers:add');
  const label = name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
  const dot: Status = active?.isDemo || system.isSuccess ? 'online' : system.isError ? 'offline' : status === 'needs-password' ? 'warning' : 'unknown';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('routers:switch')}
      onPress={() => router.push('/router-switcher')}
      hitSlop={6}>
      <GlassSurface variant="pill" interactive style={styles.capsule}>
        <StatusDot status={dot} size={8} />
        <AppText variant="subhead" weight="600" numberOfLines={1}>
          {label}
        </AppText>
        <Icon name="chevronDown" size={14} color={colors.textSecondary} />
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 },
});
