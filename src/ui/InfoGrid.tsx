import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { spacing } from './theme/tokens';

export interface InfoItem {
  label: string;
  value: string | undefined;
  /** Spans both columns (long values such as firmware strings). */
  wide?: boolean;
  selectable?: boolean;
}

/** Label/value pairs in two columns. Items without a value are skipped. */
export function InfoGrid({ items }: { items: InfoItem[] }) {
  return (
    <View style={styles.grid}>
      {items
        .filter((i) => i.value)
        .map((item) => (
          <View key={item.label} style={[styles.cell, item.wide && styles.wide]}>
            <AppText variant="footnote" tone="secondary">
              {item.label}
            </AppText>
            <AppText variant="subhead" weight="500" selectable={item.selectable} numberOfLines={item.wide ? 2 : 1}>
              {item.value}
            </AppText>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.m },
  cell: { width: '50%', paddingRight: spacing.s, gap: 2 },
  wide: { width: '100%' },
});
