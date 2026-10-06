import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { getParental, saveSchedule, validatePeriod, type BlockPeriod } from '@/api/services/parental';
import type { ApplyOutcome } from '@/api/uci';
import { useClients, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { DayPicker } from '@/ui/DayPicker';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { TimeField } from '@/ui/TimeField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { withEntry } from '@/utils/list-edit';
import { normalizeMac } from '@/utils/mac';

const NEW_PERIOD: BlockPeriod = { days: [0, 1, 2, 3, 4], from: '21:30', to: '07:00' };

/** DV-8: add a blocked period for device `?mac=`, or edit its `&index=`. Saved on its own. */
export default function EditPeriod() {
  const t = useT();
  const params = useLocalSearchParams<{ mac?: string; index?: string }>();
  const mac = normalizeMac(params.mac ?? '') ?? '';
  const client = useClients().data?.find((c) => c.mac === mac);
  const state = useRouterQuery(['parental'], getParental);
  // The device's periods as the page opened: saving changes this one of them (and the list refetches).
  const loaded = useLoaded(state.data);
  const saved = loaded?.schedules.get(mac);
  const index = params.index === undefined ? null : Number(params.index);
  const period = index === null ? undefined : saved?.periods[index];
  const title = index === null ? t('devices:parental.add') : t('devices:parental.edit');
  const missing = !mac || (index !== null && !period);
  if (!loaded || missing) {
    return (
      <FormPlaceholder
        title={title}
        error={state.error}
        onRetry={() => void state.refetch()}
        missing={!!loaded && missing}
      />
    );
  }
  return (
    <PeriodForm
      title={title}
      mac={mac}
      name={client?.name ?? mac}
      periods={saved?.periods ?? []}
      // A device's first period turns its schedule on.
      enabled={saved?.enabled ?? true}
      index={index}
      period={period}
    />
  );
}

function PeriodForm({
  title,
  mac,
  name,
  periods,
  enabled,
  index,
  period: existing,
}: {
  title: string;
  mac: string;
  name: string;
  periods: BlockPeriod[];
  enabled: boolean;
  index: number | null;
  period?: BlockPeriod;
}) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState(existing ?? NEW_PERIOD);
  const [period, setPeriod] = useState(initial);
  const [error, setError] = useState<ReturnType<typeof validatePeriod>>(null);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const save = useRouterMutation(
    (conn, list: BlockPeriod[]) => saveSchedule(conn, mac, list, enabled),
    [['parental'], ['firewall'], ['cron']],
  );

  const set = (patch: Partial<BlockPeriod>) => {
    setPeriod((p) => ({ ...p, ...patch }));
    setError(null);
  };
  const submit = () => {
    const found = validatePeriod(period);
    setError(found);
    if (!found) setPending('save');
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    save.mutate(withEntry(periods, index, kind === 'delete' ? null : period), {
      onSuccess: (outcome: ApplyOutcome) => {
        if (outcome.status === 'rolled-back') {
          toast(t('network:result.rolledBack'), 'warning');
          return;
        }
        toast(t('devices:parental.saved'));
        exit.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  return (
    <>
      <FormScreen
        title={title}
        dirty={differs(period, initial)}
        leaving={exit.leaving}
        onSave={submit}
        saving={save.isPending}
        onDelete={existing ? () => setPending('delete') : undefined}
        deleteLabel={t('devices:parental.deletePeriod')}
        testID="period-form">
        <GlassCard contentStyle={styles.card}>
          <AppText variant="headline">{name}</AppText>
          <AppText variant="footnote" tone="secondary">
            {t('devices:parental.days')}
          </AppText>
          <DayPicker value={period.days} onChange={(days) => set({ days })} lang={lang} testID="period-days" />
          <TimeField label={t('devices:parental.from')} value={period.from} onChange={(from) => set({ from })} />
          <TimeField label={t('devices:parental.to')} value={period.to} onChange={(to) => set({ to })} />
          <AppText variant="footnote" tone={error ? 'danger' : 'secondary'}>
            {error ? t(`devices:parental.error.${error}`) : t('devices:parental.overnightHint')}
          </AppText>
        </GlassCard>
      </FormScreen>

      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending === 'delete' ? t('devices:parental.deleteTitle') : t('devices:parental.confirmTitle', { name })}
        consequences={
          pending === 'delete'
            ? [t('devices:parental.consequenceRules')]
            : [t('devices:parental.consequenceRules'), t('devices:parental.consequenceCut')]
        }
        confirmLabel={pending === 'delete' ? t('devices:parental.deletePeriod') : t('devices:parental.save')}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
