import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import type { Palette } from '@/ui/theme/tokens';
import { useTheme } from '@/ui/theme/ThemeProvider';

import type { SegmentStatus } from './rules';

export type MarkState = SegmentStatus | 'running' | 'pending';

export const statusColor = (colors: Palette, s: MarkState) =>
  s === 'ok'
    ? colors.success
    : s === 'warn'
      ? colors.warning
      : s === 'fail'
        ? colors.danger
        : s === 'running'
          ? colors.accent
          : colors.textTertiary;

/** A round status badge: a tick, "!", a cross, a dash, or a spinner while the check runs. */
export function StatusMark({ state, size = 26 }: { state: MarkState; size?: number }) {
  const { colors } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (state === 'running') {
    return (
      <View style={[styles.mark, box]}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }
  if (state === 'pending') {
    return <View style={[styles.mark, box, styles.ring, { borderColor: colors.separator }]} />;
  }
  const color = statusColor(colors, state);
  return (
    <View style={[styles.mark, box, { backgroundColor: color }]} accessibilityElementsHidden>
      {state === 'ok' || state === 'fail' ? (
        <Icon name={state === 'ok' ? 'check' : 'close'} size={size * 0.6} color="#FFFFFF" />
      ) : (
        <AppText variant="headline" weight="700" style={[styles.glyph, { fontSize: size * 0.62 }]}>
          {state === 'warn' ? '!' : '–'}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
  glyph: { color: '#FFFFFF' },
});
