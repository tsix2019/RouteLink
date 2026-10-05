import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Radio } from '@/api/services/wireless';
import {
  getWifiSchedules,
  saveWifiSchedules,
  validateWifiSchedule,
  wifiOffNow,
  type WifiSchedule,
} from '@/api/services/wifi-schedule';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { bandLabel } from '@/features/wireless/labels';
import { useRadios, useRouterMutation, useRouterQuery, useSystem } from '@/hooks/router-queries';
import { useLang, useT, type AppT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { DayPicker } from '@/ui/DayPicker';
import { EditSheet } from '@/ui/EditSheet';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { TimeField } from '@/ui/TimeField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { describeDays, minutesOf } from '@/utils/weekly';

const NEW_SCHEDULE: WifiSchedule = { radios: 'all', days: [0, 1, 2, 3, 4], off: '23:30', on: '07:00' };

const radioNames = (t: AppT, s: WifiSchedule, radios: Radio[]) =>
  s.radios === 'all'
    ? t('wireless:schedule.allRadios')
    : s.radios.map((r) => bandLabel(t, radios.find((x) => x.name === r)?.band)).join(', ');

/** WL-7: Wi-Fi off and on at set times (app-managed cron entries), saved as a whole. */
export default function WifiScheduleScreen() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const state = useRouterQuery(['wifi-schedule'], getWifiSchedules);
  const radios = useRadios().data ?? [];
  const localTime = useSystem().data?.localTime;
  const [draft, setDraft] = useState<WifiSchedule[] | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; schedule: WifiSchedule } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const schedules = draft ?? state.data?.schedules ?? [];
  const save = useRouterMutation(
    (conn, list: WifiSchedule[]) => saveWifiSchedules(conn, list, state.data!.crontab),
    [['wifi-schedule'], ['cron']],
  );

  const now = localTime ? new Date(localTime * 1000) : null;
  const offNow =
    now && state.data
      ? radios.some((r) =>
          wifiOffNow(state.data.schedules, r.name, now.getUTCDay(), now.getUTCHours() * 60 + now.getUTCMinutes()),
        )
      : false;

  const summary = (s: WifiSchedule) =>
    t('wireless:schedule.summary', {
      off: t('wireless:schedule.offAt', { time: s.off }),
      on: t(minutesOf(s.on) > minutesOf(s.off) ? 'wireless:schedule.onAt' : 'wireless:schedule.onNextDay', {
        time: s.on,
      }),
    });

  return (
    <>
      <Screen
        title={t('wireless:schedule.title')}
        onRefresh={() => state.refetch()}
        top={state.data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        {state.data ? (
          <>
            <GlassCard contentStyle={styles.head}>
              <AppText variant="footnote" tone="secondary">
                {t('wireless:schedule.intro')}
              </AppText>
              {offNow ? (
                <AppText variant="subhead" tone="warning">
                  {t('wireless:schedule.offNow')}
                </AppText>
              ) : null}
            </GlassCard>
            <ListSection title={t('wireless:schedule.list')} footer={t('wireless:schedule.footer')}>
              {schedules.length ? (
                schedules.map((s, index) => (
                  <ListRow
                    key={`${index}-${s.off}-${s.on}`}
                    icon="moon"
                    title={`${describeDays(s.days, lang)} · ${radioNames(t, s, radios)}`}
                    subtitle={summary(s)}
                    chevron
                    onPress={() => setEditing({ index, schedule: s })}
                    testID={`wifi-schedule-${index}`}
                  />
                ))
              ) : (
                <ListRow title={t('wireless:schedule.empty')} disabled />
              )}
            </ListSection>
            <GlassButton
              label={t('wireless:schedule.add')}
              icon="plus"
              onPress={() => setEditing({ index: null, schedule: NEW_SCHEDULE })}
              testID="wifi-schedule-add"
            />
            {draft ? (
              <AppText variant="footnote" tone="secondary" align="center">
                {t('wireless:schedule.unsaved')}
              </AppText>
            ) : null}
            <GlassButton
              label={t('wireless:schedule.save')}
              variant="primary"
              disabled={!draft || save.isPending}
              loading={save.isPending}
              onPress={() => setConfirming(true)}
              testID="wifi-schedule-save"
            />
          </>
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1].map((i) => (
              <Skeleton key={i} height={56} radius={14} />
            ))}
          </View>
        )}
      </Screen>

      {editing ? (
        <ScheduleSheet
          initial={editing.schedule}
          isNew={editing.index === null}
          radios={radios}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.index === null
              ? undefined
              : () => {
                  setDraft(schedules.filter((_, i) => i !== editing.index));
                  setEditing(null);
                }
          }
          onSave={(schedule) => {
            setDraft(
              editing.index === null
                ? [...schedules, schedule]
                : schedules.map((s, i) => (i === editing.index ? schedule : s)),
            );
            setEditing(null);
          }}
        />
      ) : null}
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('wireless:schedule.confirmTitle')}
        consequences={[t('wireless:schedule.consequenceCut'), t('wireless:schedule.consequenceReboot')]}
        confirmLabel={t('wireless:schedule.save')}
        onConfirm={() => {
          setConfirming(false);
          save.mutate(schedules, {
            onSuccess: () => {
              toast(t('wireless:schedule.saved'));
              setDraft(null);
            },
            onError: (e) => toast(describeError(t, e).title, 'error'),
          });
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

function ScheduleSheet({
  initial,
  isNew,
  radios,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: WifiSchedule;
  isNew: boolean;
  radios: Radio[];
  onSave(schedule: WifiSchedule): void;
  onDelete?(): void;
  onCancel(): void;
}) {
  const t = useT();
  const lang = useLang();
  const [schedule, setSchedule] = useState(initial);
  const [error, setError] = useState<ReturnType<typeof validateWifiSchedule>>(null);
  const set = (patch: Partial<WifiSchedule>) => {
    setSchedule((s) => ({ ...s, ...patch }));
    setError(null);
  };
  const picked = schedule.radios === 'all' ? radios.map((r) => r.name) : schedule.radios;
  const toggleRadio = (name: string, on: boolean) => {
    const next = on ? [...picked, name] : picked.filter((r) => r !== name);
    set({ radios: next.length === radios.length ? 'all' : radios.map((r) => r.name).filter((r) => next.includes(r)) });
  };
  return (
    <EditSheet
      title={isNew ? t('wireless:schedule.add') : t('wireless:schedule.edit')}
      onCancel={onCancel}
      onDelete={onDelete}
      deleteLabel={t('wireless:schedule.deleteSchedule')}
      onSave={() => {
        const found = validateWifiSchedule(schedule);
        setError(found);
        if (!found) onSave(schedule);
      }}
      testID="wifi-schedule-sheet">
      <AppText variant="footnote" tone="secondary">
        {t('wireless:schedule.days')}
      </AppText>
      <DayPicker value={schedule.days} onChange={(days) => set({ days })} lang={lang} />
      <TimeField label={t('wireless:schedule.off')} value={schedule.off} onChange={(off) => set({ off })} />
      <TimeField label={t('wireless:schedule.on')} value={schedule.on} onChange={(on) => set({ on })} />
      <AppText variant="footnote" tone={error ? 'danger' : 'secondary'}>
        {error ? t(`wireless:schedule.error.${error}`) : t('wireless:schedule.nextDayHint')}
      </AppText>
      {radios.length > 1 ? (
        <ListSection title={t('wireless:schedule.radios')}>
          {radios.map((r) => (
            <ListRow
              key={r.name}
              title={bandLabel(t, r.band)}
              subtitle={r.name}
              switchValue={picked.includes(r.name)}
              onSwitch={(on) => toggleRadio(r.name, on)}
            />
          ))}
        </ListSection>
      ) : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  head: { gap: spacing.s },
});
