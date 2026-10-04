import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { GlassButton } from './GlassButton';
import { GlassSurface } from './glass/GlassSurface';
import { Icon } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';
import { NoBlurTarget } from './glass/BlurTarget';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  detail?: string;
  disabled?: boolean;
}

export interface SelectSheetProps<V extends string> {
  visible: boolean;
  title: string;
  options: SelectOption<V>[];
  value: V;
  onSelect(value: V): void;
  onCancel(): void;
}

/** Bottom sheet with a checkmarked list: the cross-platform stand-in for an iOS menu picker. */
export function SelectSheet<V extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onCancel,
}: SelectSheetProps<V>) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.m, maxHeight: '80%' }]}>
          <GlassSurface variant="floating" style={[styles.sheet, styles.shrink]}>
            <AppText variant="headline" align="center">
              {title}
            </AppText>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: o.disabled }}
                    disabled={o.disabled}
                    onPress={() => onSelect(o.value)}
                    style={({ pressed }) => [
                      styles.option,
                      { backgroundColor: pressed ? colors.fill : selected ? colors.fill : 'transparent' },
                      o.disabled && styles.disabled,
                    ]}
                    testID={`select-${o.value}`}>
                    <View style={styles.texts}>
                      <AppText variant="body" weight={selected ? '600' : '400'}>
                        {o.label}
                      </AppText>
                      {o.detail ? (
                        <AppText variant="footnote" tone="secondary">
                          {o.detail}
                        </AppText>
                      ) : null}
                    </View>
                    {selected ? <Icon name="check" size={20} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.l, gap: spacing.m },
  list: { flexGrow: 0, flexShrink: 1 },
  shrink: { flexShrink: 1 },
  listContent: { gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    borderRadius: 14,
  },
  texts: { flex: 1, gap: 2 },
  disabled: { opacity: 0.4 },
});
