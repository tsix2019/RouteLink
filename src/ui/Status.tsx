import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useTheme } from './theme/ThemeProvider';

export type Status = 'online' | 'offline' | 'warning' | 'unknown';

export function StatusDot({ status, size = 9 }: { status: Status; size?: number }) {
  const { colors } = useTheme();
  const color = { online: colors.success, offline: colors.textTertiary, warning: colors.warning, unknown: colors.textTertiary }[status];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} accessibilityLabel={status} />;
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const color = { neutral: colors.textSecondary, accent: colors.accent, success: colors.success, warning: colors.warning, danger: colors.danger }[tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <AppText variant="caption" weight="600" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

/** Four bars from an RSSI in dBm. */
export function SignalBars({ dbm, size = 14 }: { dbm: number; size?: number }) {
  const { colors } = useTheme();
  const level = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : dbm >= -85 ? 1 : 0;
  return (
    <View style={[styles.bars, { height: size }]} accessibilityLabel={`${dbm} dBm`}>
      {[1, 2, 3, 4].map((bar) => (
        <View
          key={bar}
          style={{
            width: size / 5,
            height: (size * bar) / 4,
            borderRadius: 1,
            backgroundColor: bar <= level ? colors.text : colors.separator,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
});
