import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from './AppText';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export function ListSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.section}>
      {title ? (
        <AppText variant="footnote" tone="secondary" style={styles.sectionTitle}>
          {title}
        </AppText>
      ) : null}
      <GlassSurface style={styles.card}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.separator }]} /> : null}
            {row}
          </Fragment>
        ))}
      </GlassSurface>
      {footer ? (
        <AppText variant="footnote" tone="tertiary" style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  iconColor?: string;
  left?: ReactNode;
  right?: ReactNode;
  chevron?: boolean;
  switchValue?: boolean;
  onSwitch?: (value: boolean) => void;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Shown under the title when the row is disabled, e.g. "Requires luci-app-wol". */
  disabledReason?: string;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconColor,
  left,
  right,
  chevron,
  switchValue,
  onSwitch,
  onPress,
  onLongPress,
  destructive,
  disabled,
  disabledReason,
  testID,
}: ListRowProps) {
  const { colors } = useTheme();
  const body = (
    <View style={[styles.row, disabled && styles.disabled]}>
      {left ??
        (icon ? (
          <Icon name={icon} size={20} color={iconColor ?? (destructive ? colors.danger : colors.accent)} />
        ) : null)}
      <View style={styles.texts}>
        <AppText variant="body" tone={destructive ? 'danger' : 'primary'} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle || (disabled && disabledReason) ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={2}>
            {disabled && disabledReason ? disabledReason : subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="subhead" tone="secondary" numberOfLines={1} style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {right}
      {switchValue !== undefined ? (
        <Switch value={switchValue} onValueChange={onSwitch} disabled={disabled} trackColor={{ true: colors.accent }} />
      ) : null}
      {chevron ? <Icon name="chevronRight" size={16} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.separator : 'transparent' })}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.s },
  sectionTitle: { marginLeft: spacing.l, textTransform: 'uppercase' },
  card: { paddingVertical: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  footer: { marginHorizontal: spacing.l },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    minHeight: 52,
  },
  texts: { flex: 1, gap: 2 },
  value: { maxWidth: '45%' },
  disabled: { opacity: 0.5 },
});
