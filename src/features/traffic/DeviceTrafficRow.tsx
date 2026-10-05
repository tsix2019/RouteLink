import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Sparkline } from '@/ui/charts/Sparkline';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBitRate, formatBytes } from '@/utils/format';

import type { DeviceLabel } from './labels';

function DeviceIcon({ label }: { label: DeviceLabel }) {
  const { colors } = useTheme();
  const on = label.online !== false;
  return (
    <View style={[styles.icon, { backgroundColor: on ? colors.accent : colors.separator }]}>
      <Icon name={label.icon} size={17} color={on ? colors.accentText : colors.textSecondary} />
    </View>
  );
}

/** Ranking row: device, its download and upload in the range, and its share of the total as a bar. */
export function DeviceTrafficRow({
  label,
  rx,
  tx,
  share,
  onPress,
}: {
  label: DeviceLabel;
  rx: number;
  tx: number;
  /** 0..1 of the largest value in the list. */
  share: number;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={`traffic-${label.mac}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.fill : 'transparent' }]}>
      <DeviceIcon label={label} />
      <View style={styles.body}>
        <View style={styles.line}>
          <AppText variant="body" numberOfLines={1} style={styles.name}>
            {label.name}
          </AppText>
          <AppText variant="subhead" style={{ color: colors.chartDown }}>{`↓ ${formatBytes(rx)}`}</AppText>
        </View>
        <View style={styles.line}>
          <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.name}>
            {label.detail}
          </AppText>
          <AppText variant="footnote" style={{ color: colors.chartUp }}>{`↑ ${formatBytes(tx)}`}</AppText>
        </View>
        <View style={[styles.track, { backgroundColor: colors.fill }]}>
          <View
            style={[
              styles.bar,
              { width: `${Math.max(1, Math.min(100, share * 100))}%`, backgroundColor: colors.chartDown },
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

/** Live row: current rates and the last minute of download as a sparkline. */
export function LiveTrafficRow({
  label,
  rxBps,
  txBps,
  history,
  onPress,
}: {
  label: DeviceLabel;
  rxBps: number;
  txBps: number;
  history: readonly number[];
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={`live-${label.mac}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.fill : 'transparent' }]}>
      <DeviceIcon label={label} />
      <View style={styles.body}>
        <AppText variant="body" numberOfLines={1}>
          {label.name}
        </AppText>
        <View style={styles.rates}>
          <AppText variant="footnote" style={{ color: colors.chartDown }}>{`↓ ${formatBitRate(rxBps)}`}</AppText>
          <AppText variant="footnote" style={{ color: colors.chartUp }}>{`↑ ${formatBitRate(txBps)}`}</AppText>
        </View>
      </View>
      <Sparkline values={history} width={84} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s },
  name: { flex: 1 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  bar: { height: 4, borderRadius: 2 },
  rates: { flexDirection: 'row', gap: spacing.m },
});
