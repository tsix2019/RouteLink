import { Fragment } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { GlassButton } from './GlassButton';
import { NoBlurTarget } from './glass/BlurTarget';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  onPress(): void;
}

/** iOS-style action sheet: a grouped list of actions above a separate Cancel button. */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  cancelLabel,
  onCancel,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  /** Defaults to Cancel. */
  cancelLabel?: string;
  onCancel(): void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.m }]}>
          <GlassSurface variant="floating" style={styles.group}>
            {title || message ? (
              <View style={styles.header}>
                {title ? (
                  <AppText variant="subhead" weight="600" tone="secondary" align="center">
                    {title}
                  </AppText>
                ) : null}
                {message ? (
                  <AppText variant="footnote" tone="secondary" align="center">
                    {message}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            {actions.map((a, i) => (
              <Fragment key={a.label}>
                {i > 0 || title || message ? (
                  <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={a.disabled}
                  onPress={a.onPress}
                  style={({ pressed }) => [
                    styles.action,
                    pressed && { backgroundColor: colors.fill },
                    a.disabled && styles.disabled,
                  ]}>
                  {a.icon ? (
                    <Icon name={a.icon} size={20} color={a.destructive ? colors.danger : colors.accent} />
                  ) : null}
                  <AppText variant="body" style={{ color: a.destructive ? colors.danger : colors.accent }}>
                    {a.label}
                  </AppText>
                </Pressable>
              </Fragment>
            ))}
          </GlassSurface>
          <GlassButton label={cancelLabel ?? t('cancel')} onPress={onCancel} />
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0, gap: spacing.s },
  group: { overflow: 'hidden' },
  header: { paddingHorizontal: spacing.l, paddingVertical: spacing.m, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth },
  action: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.l,
  },
  disabled: { opacity: 0.4 },
});
