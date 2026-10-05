import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, useT, type AppLanguage } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { Toggle } from '@/ui/Toggle';
import { formatDayTime } from '@/utils/dates';

import { PRESETS, rangeLabel, resolveRange, validateCustom, type HourWindow, type TimeRange } from './timeRange';

const DEFAULT_HOURS: HourWindow = { from: 20, to: 23 };

/** Preset capsules plus "Custom"; the resolved range is spelled out underneath. */
export function TimeRangePicker({ value, onChange }: { value: TimeRange; onChange(range: TimeRange): void }) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const [custom, setCustom] = useState(false);
  const selected = value.kind === 'preset' ? value.id : 'custom';

  const chip = (id: string, label: string, onPress: () => void) => {
    const active = id === selected;
    return (
      <Pressable
        key={id}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        testID={`range-${id}`}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: active ? colors.accent : pressed ? colors.fill : colors.card,
            borderColor: colors.separator,
          },
        ]}>
        <AppText variant="subhead" weight={active ? '600' : '400'} style={active ? styles.chipActive : undefined}>
          {label}
        </AppText>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PRESETS.map((id) =>
          chip(id, t(`traffic:presets.${id}`), () => onChange({ kind: 'preset', id, hours: value.hours })),
        )}
        {chip('custom', t('traffic:presets.custom'), () => setCustom(true))}
      </ScrollView>
      <View style={styles.label}>
        <Icon name="timer" size={13} color={colors.textTertiary} />
        <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.labelText}>
          {rangeLabel(t, value, lang)}
        </AppText>
      </View>
      {custom ? (
        <CustomRangeSheet
          initial={value}
          onCancel={() => setCustom(false)}
          onDone={(range) => {
            setCustom(false);
            onChange(range);
          }}
        />
      ) : null}
    </View>
  );
}

const minuteStart = (d: Date) => {
  const c = new Date(d);
  c.setSeconds(0, 0);
  return c;
};

/** Start and end to the minute, optionally only some hours of each day. */
export function CustomRangeSheet({
  initial,
  onCancel,
  onDone,
  now = new Date(),
}: {
  initial: TimeRange;
  onCancel(): void;
  onDone(range: TimeRange): void;
  now?: Date;
}) {
  const t = useT();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const resolved = resolveRange(initial, now);
  const [start, setStart] = useState(minuteStart(new Date(resolved.start * 1000)));
  const [end, setEnd] = useState(minuteStart(new Date(resolved.end * 1000)));
  const [hours, setHours] = useState<HourWindow | undefined>(initial.hours);
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.floor(end.getTime() / 1000);
  const verdict = validateCustom(startSec, endSec, Math.floor(now.getTime() / 1000));

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.m }]}>
          <GlassSurface variant="floating" style={styles.sheet}>
            <AppText variant="headline" align="center">
              {t('traffic:picker.title')}
            </AppText>
            <DateRow
              label={t('traffic:picker.start')}
              value={start}
              onChange={setStart}
              lang={lang}
              testID="custom-start"
            />
            <DateRow label={t('traffic:picker.end')} value={end} onChange={setEnd} lang={lang} testID="custom-end" />
            <View style={styles.row}>
              <AppText variant="body" style={styles.rowLabel}>
                {t('traffic:picker.hours')}
              </AppText>
              <Toggle
                value={!!hours}
                onValueChange={(on) => setHours(on ? (hours ?? DEFAULT_HOURS) : undefined)}
                accessibilityLabel={t('traffic:picker.hours')}
              />
            </View>
            {hours ? (
              <View style={styles.hours}>
                <HourStepper
                  label={t('traffic:picker.from')}
                  value={hours.from}
                  onChange={(from) => setHours({ ...hours, from })}
                />
                <HourStepper
                  label={t('traffic:picker.to')}
                  value={hours.to}
                  onChange={(to) => setHours({ ...hours, to })}
                />
              </View>
            ) : null}
            {verdict !== 'ok' ? (
              <AppText variant="footnote" tone="danger" align="center" testID="custom-error">
                {t(`traffic:picker.errors.${verdict}`)}
              </AppText>
            ) : null}
            <View style={styles.buttons}>
              <GlassButton label={t('cancel')} onPress={onCancel} style={styles.button} />
              <GlassButton
                label={t('done')}
                variant="primary"
                disabled={verdict !== 'ok'}
                onPress={() => onDone({ kind: 'custom', start: startSec, end: endSec, hours })}
                style={styles.button}
                testID="custom-done"
              />
            </View>
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

/** iOS: the system compact picker. Android has no combined date-and-time dialog: date first, then time. */
function DateRow({
  label,
  value,
  onChange,
  lang,
  testID,
}: {
  label: string;
  value: Date;
  onChange(d: Date): void;
  lang: AppLanguage;
  testID: string;
}) {
  const { colors } = useTheme();
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.row} testID={testID}>
        <AppText variant="body" style={styles.rowLabel}>
          {label}
        </AppText>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="compact"
          onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(minuteStart(d))}
        />
      </View>
    );
  }
  const pick = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      onChange: (e, date) => {
        if (e.type !== 'set' || !date) return;
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          onChange: (e2, time) => {
            if (e2.type === 'set' && time) onChange(minuteStart(time));
          },
        });
      },
    });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={pick}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        styles.rowButton,
        { backgroundColor: pressed ? colors.fill : 'transparent' },
      ]}>
      <AppText variant="body" style={styles.rowLabel}>
        {label}
      </AppText>
      <AppText variant="body" tone="accent">
        {formatDayTime(Math.floor(value.getTime() / 1000), lang)}
      </AppText>
    </Pressable>
  );
}

function HourStepper({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  const { colors } = useTheme();
  const button = (icon: 'chevronLeft' | 'chevronRight', next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${next}:00`}
      hitSlop={6}
      onPress={() => onChange(next)}
      style={({ pressed }) => [styles.step, { backgroundColor: pressed ? colors.fill : colors.card }]}>
      <Icon name={icon} size={16} color={colors.accent} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
      <View style={styles.stepperRow}>
        {button('chevronLeft', (value + 23) % 24)}
        <AppText variant="headline" style={styles.hour}>{`${String(value).padStart(2, '0')}:00`}</AppText>
        {button('chevronRight', (value + 1) % 24)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.s },
  chips: { gap: spacing.s, paddingHorizontal: 2 },
  chip: {
    paddingHorizontal: spacing.m,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipActive: { color: '#FFFFFF' },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.s },
  labelText: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.l, gap: spacing.m },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.m },
  rowButton: { borderRadius: 12, paddingHorizontal: spacing.s },
  rowLabel: { flex: 1 },
  hours: { flexDirection: 'row', justifyContent: 'space-around' },
  stepper: { alignItems: 'center', gap: 4 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  step: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hour: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', gap: spacing.m },
  button: { flex: 1 },
});
