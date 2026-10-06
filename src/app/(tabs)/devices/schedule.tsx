import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { activePeriod, getParental, saveSchedule } from '@/api/services/parental';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useClients, useRouterMutation, useRouterQuery, useSystem } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { normalizeMac } from '@/utils/mac';
import { describeDays, describeWindow } from '@/utils/weekly';

/** DV-8: blocked periods for one device, each edited and saved on its own page; switched on and off here. */
export default function ParentalSchedule() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const mac = normalizeMac(useLocalSearchParams<{ mac: string }>().mac ?? '') ?? '';
  const client = useClients().data?.find((c) => c.mac === mac);
  const state = useRouterQuery(['parental'], getParental);
  const localTime = useSystem().data?.localTime;
  const saved = state.data?.schedules.get(mac);
  const nav = useRouter();
  // The switch flipped, waiting for its confirmation.
  const [switching, setSwitching] = useState<boolean | null>(null);
  const name = client?.name ?? mac;
  const periods = saved?.periods ?? [];
  const periodHref = (index?: number) =>
    `/devices/edit/period?mac=${encodeURIComponent(mac)}${index === undefined ? '' : `&index=${index}`}` as const;

  const save = useRouterMutation(
    (conn, enabled: boolean) => saveSchedule(conn, mac, periods, enabled),
    [['parental'], ['firewall'], ['cron']],
  );

  // Router-local clock (system info's localtime is local seconds, read with UTC getters).
  const now = localTime ? new Date(localTime * 1000) : null;
  const blocking =
    now && saved?.enabled
      ? activePeriod(saved.periods, now.getUTCDay(), now.getUTCHours() * 60 + now.getUTCMinutes())
      : null;

  const commit = () => {
    const enabled = switching;
    setSwitching(null);
    if (enabled === null) return;
    save.mutate(enabled, {
      onSuccess: (outcome) =>
        outcome.status === 'rolled-back'
          ? toast(t('network:result.rolledBack'), 'warning')
          : toast(t('devices:parental.saved')),
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
                // Nothing to switch before the first period: that one turns the schedule on.
                switchValue={saved?.enabled ?? true}
                onSwitch={setSwitching}
                disabled={!saved || save.isPending}
                testID="parental-enabled"
              />
            </ListSection>
            <ListSection title={t('devices:parental.periods')} footer={t('devices:parental.footer')}>
              {periods.length ? (
                periods.map((p, index) => (
                  <ListRow
                    key={`${p.from}-${p.to}-${p.days.join()}`}
                    icon="hourglass"
                    title={describeDays(p.days, lang)}
                    subtitle={describeWindow(p.from, p.to, lang)}
                    chevron
                    onPress={() => nav.push(periodHref(index))}
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
              onPress={() => nav.push(periodHref())}
              testID="period-add"
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

      <RiskConfirm
        visible={switching !== null}
        level="medium"
        disruptive
        title={t('devices:parental.confirmTitle', { name })}
        consequences={
          switching
            ? [t('devices:parental.consequenceRules'), t('devices:parental.consequenceCut')]
            : [t('devices:parental.consequenceRules')]
        }
        confirmLabel={t('devices:parental.save')}
        onConfirm={commit}
        onCancel={() => setSwitching(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  head: { gap: spacing.s },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.xs },
  flex: { flex: 1 },
});
