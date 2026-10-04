import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export interface GlassCardProps {
  title?: string;
  subtitle?: string;
  icon?: IconName;
  accessory?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassCard({ title, subtitle, icon, accessory, children, style, contentStyle, testID }: GlassCardProps) {
  const { colors } = useTheme();
  return (
    <GlassSurface style={[styles.card, style]} testID={testID}>
      {title ? (
        <View style={styles.header}>
          {icon ? <Icon name={icon} size={18} color={colors.accent} /> : null}
          <View style={styles.headerText}>
            <AppText variant="headline">{title}</AppText>
            {subtitle ? (
              <AppText variant="footnote" tone="secondary">
                {subtitle}
              </AppText>
            ) : null}
          </View>
          {accessory}
        </View>
      ) : null}
      <View style={contentStyle}>{children}</View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.l, gap: spacing.m },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  headerText: { flex: 1 },
});
