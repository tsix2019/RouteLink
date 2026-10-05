import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { activePeriod, getParental, saveSchedule, validatePeriod, type BlockPeriod } from '@/api/services/parental';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useClients, useRouterMutation, useRouterQuery, useSystem } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
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
import { StatusDot } from '@/ui/Status';
import { TimeField } from '@/ui/TimeField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { normalizeMac } from '@/utils/mac';
import { describeDays, describeWindow } from '@/utils/weekly';

interface Draft {
  enabled: boolean;
  periods: BlockPeriod[];
}

const NEW_PERIOD: BlockPeriod = { days: [0, 1, 2, 3, 4], from: '21:30', to: '07:00' };

/** DV-8: blocked periods for one device, saved as a whole with "Save and Apply". */
export default function ParentalSchedule() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const mac = normalizeMac(useLocalSearchParams<{ mac: string }>().mac ?? '') ?? '';
  const client = useClients().data?.find((c) => c.mac === mac);
  const state = useRouterQuery(['parental'], getParental);
  const localTime = useSystem().data?.localTime;
  const saved = state.data?.schedules.get(mac);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; period: BlockPeriod } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const current: Draft = draft ?? { enabled: saved?.enabled ?? true, periods: saved?.periods ?? [] };
  const name = client?.name ?? mac;

  const save = useRouterMutation(
    (conn, d: Draft) => saveSchedule(conn, mac, d.periods, d.enabled),
    [['parental'], ['firewall'], ['cron']],
  );

  // Router-local clock (system info's localtime is local seconds, read with UTC getters).
  const now = localTime ? new Date(localTime * 1000) : null;
  const blocking =
    now && saved?.enabled
      ? activePeriod(saved.periods, now.getUTCDay(), now.getUTCHours() * 60 + now.getUTCMinutes())
      : null;

  const update = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const commit = () => {
    setConfirming(false);
    save.mutate(current, {
      onSuccess: (outcome) => {
        if (outcome.status === 'rolled-back') toast(t('network:result.rolledBack'), 'warning');
        else {
          toast(t('devices:parental.saved'));
          setDraft(null);
        }
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  return (
    <>
      <Screen
        title={t('devices:parental.title')}
        onRefresh={() => state.refetch()}
        top={state.data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        {state.data ? (
          <>
            <GlassCard contentStyle={styles.head}>
              <AppText variant="headline">{name}</AppText>
              <AppText variant="footnote" tone="secondary">
                {t('devices:parental.intro')}
              </AppText>
              {saved ? (
                <View style={styles.status}>
                  <StatusDot status={blocking ? 'warning' : 'online'} />
                  <AppText variant="subhead" style={styles.flex}>
                    {blocking
                      ? t('devices:parental.blockedNow', { window: describeWindow(blocking.from, blocking.to, lang) })
                      : t('devices:parental.allowedNow')}
                  </AppText>
                  {now ? (
                    <AppText variant="footnote" tone="tertiary">
                      {t('devices:parental.routerTime', { time: now.toISOString().slice(11, 16) })}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </GlassCard>
            <ListSection>
              <ListRow
                title={t('devices:parental.enabled')}
                switchValue={current.enabled}
                onSwitch={(enabled) => update({ enabled })}
                testID="parental-enabled"
              />
            </ListSection>
            <ListSection title={t('devices:parental.periods')} footer={t('devices:parental.footer')}>
              {current.periods.length ? (
                current.periods.map((p, index) => (
                  <ListRow
                    key={`${p.from}-${p.to}-${p.days.join()}`}
                    icon="hourglass"
                    title={describeDays(p.days, lang)}
                    subtitle={describeWindow(p.from, p.to, lang)}
                    chevron
                    onPress={() => setEditing({ index, period: p })}
                    testID={`period-${index}`}
                  />
                ))
              ) : (
                <ListRow title={t('devices:parental.noPeriods')} disabled />
              )}
            </ListSection>
            <GlassButton
              label={t('devices:parental.add')}
              icon="plus"
              onPress={() => setEditing({ index: null, period: NEW_PERIOD })}
              testID="period-add"
            />
            {draft ? (
              <AppText variant="footnote" tone="secondary" align="center">
                {t('devices:parental.unsaved')}
              </AppText>
            ) : null}
            <GlassButton
              label={t('devices:parental.save')}
              variant="primary"
              disabled={!draft || save.isPending}
              loading={save.isPending}
              onPress={() => setConfirming(true)}
              testID="parental-save"
            />
          </>
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={56} radius={14} />
            ))}
          </View>
        )}
      </Screen>

      {editing ? (
        <PeriodSheet
          initial={editing.period}
          isNew={editing.index === null}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.index === null
              ? undefined
              : () => {
                  update({ periods: current.periods.filter((_, i) => i !== editing.index) });
                  setEditing(null);
                }
          }
          onSave={(period) => {
            const periods =
              editing.index === null
                ? [...current.periods, period]
                : current.periods.map((p, i) => (i === editing.index ? period : p));
            update({ periods });
            setEditing(null);
          }}
        />
      ) : null}
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('devices:parental.confirmTitle', { name })}
        consequences={[t('devices:parental.consequenceRules'), t('devices:parental.consequenceCut')]}
        confirmLabel={t('devices:parental.save')}
        onConfirm={commit}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

function PeriodSheet({
  initial,
  isNew,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: BlockPeriod;
  isNew: boolean;
  onSave(period: BlockPeriod): void;
  onDelete?(): void;
  onCancel(): void;
}) {
  const t = useT();
  const lang = useLang();
  const [period, setPeriod] = useState(initial);
  const [error, setError] = useState<ReturnType<typeof validatePeriod>>(null);
  const set = (patch: Partial<BlockPeriod>) => {
    setPeriod((p) => ({ ...p, ...patch }));
    setError(null);
  };
  return (
    <EditSheet
      title={isNew ? t('devices:parental.add') : t('devices:parental.edit')}
      onCancel={onCancel}
      onDelete={onDelete}
      deleteLabel={t('devices:parental.deletePeriod')}
      onSave={() => {
        const found = validatePeriod(period);
        setError(found);
        if (!found) onSave(period);
      }}
      testID="period-sheet">
      <AppText variant="footnote" tone="secondary">
        {t('devices:parental.days')}
      </AppText>
      <DayPicker value={period.days} onChange={(days) => set({ days })} lang={lang} testID="period-days" />
      <TimeField label={t('devices:parental.from')} value={period.from} onChange={(from) => set({ from })} />
      <TimeField label={t('devices:parental.to')} value={period.to} onChange={(to) => set({ to })} />
      <AppText variant="footnote" tone={error ? 'danger' : 'secondary'}>
        {error ? t(`devices:parental.error.${error}`) : t('devices:parental.overnightHint')}
      </AppText>
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  head: { gap: spacing.s },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.xs },
  flex: { flex: 1 },
});
