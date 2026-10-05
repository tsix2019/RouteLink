import { Pressable, StyleSheet, View } from 'react-native';

import type { AppLanguage } from '@/i18n';
import { sortDays, type Weekday } from '@/utils/weekly';

import { AppText } from './AppText';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

/** Monday first, as calendars in China (and most of Europe) show the week. */
const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const LABELS: Record<AppLanguage, string[]> = {
  'zh-CN': ['日', '一', '二', '三', '四', '五', '六'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
};
const PRESETS: { id: 'all' | 'weekdays' | 'weekends'; days: Weekday[] }[] = [
  { id: 'all', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weekdays', days: [1, 2, 3, 4, 5] },
  { id: 'weekends', days: [0, 6] },
];
const PRESET_LABELS: Record<AppLanguage, Record<(typeof PRESETS)[number]['id'], string>> = {
  'zh-CN': { all: '每天', weekdays: '工作日', weekends: '周末' },
  en: { all: 'Every day', weekdays: 'Weekdays', weekends: 'Weekends' },
};

/** Seven round day toggles with shortcuts for every day, weekdays and weekends. */
export function DayPicker({
  value,
  onChange,
  lang,
  testID,
}: {
  value: Weekday[];
  onChange(days: Weekday[]): void;
  lang: AppLanguage;
  testID?: string;
}) {
  const { colors } = useTheme();
  const toggle = (d: Weekday) => onChange(sortDays(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]));
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.days}>
        {ORDER.map((d) => {
          const on = value.includes(d);
          return (
            <Pressable
              key={d}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={LABELS[lang][d]}
              onPress={() => toggle(d)}
              testID={testID ? `${testID}-${d}` : undefined}
              style={[
                styles.day,
                { backgroundColor: on ? colors.accent : colors.fill, borderColor: colors.separator },
              ]}>
              <AppText variant="subhead" weight="600" style={on ? styles.onText : undefined}>
                {LABELS[lang][d]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.presets}>
        {PRESETS.map((p) => {
          const active = sortDays(value).join() === p.days.join();
          return (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => onChange(p.days)} hitSlop={6}>
              <AppText variant="footnote" tone={active ? 'accent' : 'secondary'} weight={active ? '600' : '400'}>
                {PRESET_LABELS[lang][p.id]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.s },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  onText: { color: '#FFFFFF' },
  presets: { flexDirection: 'row', gap: spacing.l, paddingHorizontal: 2 },
});
