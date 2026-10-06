import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionError } from '@/api/services/action-error';
import type { Crontab } from '@/api/services/cron';
import {
  getWifiSchedules,
  saveWifiSchedules,
  validateWifiSchedule,
  type WifiSchedule,
} from '@/api/services/wifi-schedule';
import type { Radio } from '@/api/services/wireless';
import { bandLabel } from '@/features/wireless/labels';
import { useRadios, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { DayPicker } from '@/ui/DayPicker';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { TimeField } from '@/ui/TimeField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { findNearest, withEntry } from '@/utils/list-edit';

const NEW_SCHEDULE: WifiSchedule = { radios: 'all', days: [0, 1, 2, 3, 4], off: '23:30', on: '07:00' };

type Saved = { schedules: WifiSchedule[]; crontab: Crontab };

/** WL-7: add a Wi-Fi off/on schedule, or edit `?index=`. Saved on its own: the list with this one changed. */
export default function EditWifiSchedule() {
  const t = useT();
  const params = useLocalSearchParams<{ index?: string }>();
  const state = useRouterQuery(['wifi-schedule'], getWifiSchedules);
  const radios = useRadios();
  // The schedules as the page opened: saving changes this one of them (and the list refetches).
  const loaded = useLoaded(state.data);
  const index = params.index === undefined ? null : Number(params.index);
  const schedule = index === null ? undefined : loaded?.schedules[index];
  const title = index === null ? t('wireless:schedule.add') : t('wireless:schedule.edit');
  if (!loaded || !radios.data || (index !== null && !schedule)) {
    return (
      <FormPlaceholder
        title={title}
        error={state.error ?? radios.error}
        onRetry={() => void Promise.all([state.refetch(), radios.refetch()])}
        missing={!!loaded && index !== null && !schedule}
      />
    );
  }
  return (
    <ScheduleForm
      title={title}
      saved={loaded}
      index={index}
      schedule={schedule}
      radios={radios.data}
      reload={() => state.refetch().then((r) => r.data)}
    />
  );
}

function ScheduleForm({
  title,
  saved,
  index,
  schedule: existing,
  radios,
  reload,
}: {
  title: string;
  saved: Saved;
  index: number | null;
  schedule?: WifiSchedule;
  radios: Radio[];
  reload(): Promise<Saved | undefined>;
}) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const exit = useFormExit();
  // Moves to a fresh read when the crontab was changed elsewhere before saving.
  const [base, setBase] = useState({ saved, index });
  const [gone, setGone] = useState(false);
  const [initial] = useState(existing ?? NEW_SCHEDULE);
  const [schedule, setSchedule] = useState(initial);
  const [error, setError] = useState<ReturnType<typeof validateWifiSchedule>>(null);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const save = useRouterMutation(
    (conn, a: Saved) => saveWifiSchedules(conn, a.schedules, a.crontab),
    [['wifi-schedule'], ['cron']],
  );

  const set = (patch: Partial<WifiSchedule>) => {
    setSchedule((s) => ({ ...s, ...patch }));
    setError(null);
  };
  const picked = schedule.radios === 'all' ? radios.map((r) => r.name) : schedule.radios;
  const toggleRadio = (name: string, on: boolean) => {
    const next = on ? [...picked, name] : picked.filter((r) => r !== name);
    set({ radios: next.length === radios.length ? 'all' : radios.map((r) => r.name).filter((r) => next.includes(r)) });
  };

  const submit = () => {
    const found = validateWifiSchedule(schedule);
    setError(found);
    if (!found) setPending('save');
  };

  const changedElsewhere = async () => {
    toast(t('more:cronScreen.changed'), 'error');
    const fresh = await reload();
    if (!fresh) return;
    if (base.index === null || !existing) return setBase({ saved: fresh, index: null });
    const at = findNearest(fresh.schedules, (s) => !differs(s, existing), base.index);
    if (at === null) setGone(true);
    else setBase({ saved: fresh, index: at });
  };

  const run = () => {
    const kind = pending;
    setPending(null);
    const schedules = withEntry(base.saved.schedules, base.index, kind === 'delete' ? null : schedule);
    save.mutate(
      { schedules, crontab: base.saved.crontab },
      {
        onSuccess: () => {
          toast(t('wireless:schedule.saved'));
          exit.back();
        },
        onError: (e) => {
          if (e instanceof ActionError && e.code === 'cron-changed') void changedElsewhere();
          else toast(describeError(t, e).title, 'error');
        },
      },
    );
  };

  if (gone) return <FormPlaceholder title={title} missing />;
  return (
    <>
      <FormScreen
        title={title}
        dirty={differs(schedule, initial)}
        leaving={exit.leaving}
        onSave={submit}
        saving={save.isPending}
        onDelete={existing ? () => setPending('delete') : undefined}
        deleteLabel={t('wireless:schedule.deleteSchedule')}
        testID="wifi-schedule-form">
        <GlassCard contentStyle={styles.card}>
          <AppText variant="footnote" tone="secondary">
            {t('wireless:schedule.days')}
          </AppText>
          <DayPicker value={schedule.days} onChange={(days) => set({ days })} lang={lang} />
          <TimeField label={t('wireless:schedule.off')} value={schedule.off} onChange={(off) => set({ off })} />
          <TimeField label={t('wireless:schedule.on')} value={schedule.on} onChange={(on) => set({ on })} />
          <AppText variant="footnote" tone={error ? 'danger' : 'secondary'}>
            {error ? t(`wireless:schedule.error.${error}`) : t('wireless:schedule.nextDayHint')}
          </AppText>
        </GlassCard>
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
      </FormScreen>

      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive={pending === 'save'}
        title={pending === 'delete' ? t('wireless:schedule.deleteTitle') : t('wireless:schedule.confirmTitle')}
        consequences={
          pending === 'delete'
            ? [t('wireless:schedule.deleteConsequence')]
            : [t('wireless:schedule.consequenceCut'), t('wireless:schedule.consequenceReboot')]
        }
        confirmLabel={pending === 'delete' ? t('wireless:schedule.deleteSchedule') : t('wireless:schedule.save')}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
