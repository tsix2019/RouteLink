import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

const toDate = (hhmm: string) => {
  const d = new Date(2026, 0, 1, 0, 0, 0, 0);
  d.setHours(Number(hhmm.slice(0, 2)) || 0, Number(hhmm.slice(3, 5)) || 0);
  return d;
};
const toText = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** A labelled HH:MM value: the compact system picker on iOS, the clock dialog on Android (24-hour). */
export function TimeField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  testID?: string;
}) {
  const { colors } = useTheme();
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.row} testID={testID}>
        <AppText variant="body" style={styles.label}>
          {label}
        </AppText>
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display="compact"
          locale="en_GB"
          onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(toText(d))}
        />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}`}
      testID={testID}
      onPress={() =>
        DateTimePickerAndroid.open({
          value: toDate(value),
          mode: 'time',
          is24Hour: true,
          onChange: (e, d) => {
            if (e.type === 'set' && d) onChange(toText(d));
          },
        })
      }
      style={({ pressed }) => [styles.row, styles.button, { backgroundColor: pressed ? colors.fill : 'transparent' }]}>
      <AppText variant="body" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="headline" tone="accent">
        {value}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.m },
  button: { borderRadius: 10, paddingHorizontal: spacing.s },
  label: { flex: 1 },
});
