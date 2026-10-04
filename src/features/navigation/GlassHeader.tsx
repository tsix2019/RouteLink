import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

type HeaderSlot = (props: { canGoBack: boolean; tintColor?: string }) => ReactNode;

/** The subset of native-stack header props this header uses. */
export interface GlassHeaderProps {
  options: { title?: string; headerTitle?: unknown; headerLeft?: HeaderSlot; headerRight?: HeaderSlot };
  route: { name: string };
  back?: unknown;
}

/** Android header: large title on a translucent glass strip; back arrow on pushed screens. */
export function GlassHeader({ options, route, back }: GlassHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : (options.title ?? route.name);
  const left = back ? (
    <Pressable accessibilityRole="button" accessibilityLabel="back" onPress={() => router.back()} hitSlop={12} style={styles.back}>
      <Icon name="chevronRight" size={22} color={colors.accent} />
    </Pressable>
  ) : (
    options.headerLeft?.({ canGoBack: false, tintColor: colors.accent })
  );
  const right = options.headerRight?.({ canGoBack: !!back, tintColor: colors.accent });

  return (
    <View
      style={[
        styles.wrap,
        { paddingTop: insets.top + spacing.s, backgroundColor: colors.glassFillStrong, borderBottomColor: colors.separator },
      ]}>
      <View style={styles.bar}>
        <View style={styles.side}>{left}</View>
        <View style={styles.side}>{right}</View>
      </View>
      <AppText variant={back ? 'title' : 'largeTitle'} numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.l, paddingBottom: spacing.m, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  side: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  back: { transform: [{ rotate: '180deg' }], padding: 4 },
  title: { marginTop: spacing.xs },
});
