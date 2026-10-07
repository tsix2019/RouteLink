import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Radio } from '@/api/services/wireless';
import { getWifiSchedules, wifiOffNow, type WifiSchedule } from '@/api/services/wifi-schedule';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { bandLabel } from '@/features/wireless/labels';
import { useRadios, useRouterQuery, useSystem } from '@/hooks/router-queries';
import { useLang, useT, type AppT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { spacing } from '@/ui/theme/tokens';
import { describeDays, minutesOf } from '@/utils/weekly';

const radioNames = (t: AppT, s: WifiSchedule, radios: Radio[]) =>
  s.radios === 'all'
    ? t('wireless:schedule.allRadios')
    : s.radios.map((r) => bandLabel(t, radios.find((x) => x.name === r)?.band)).join(', ');

/** WL-7: Wi-Fi off and on at set times (app-managed cron entries), each edited and saved on its own page. */
export default function WifiScheduleScreen() {
  const t = useT();
  const lang = useLang();
  const state = useRouterQuery(['wifi-schedule'], getWifiSchedules);
  const radios = useRadios().data ?? [];
  const localTime = useSystem().data?.localTime;
  const nav = useRouter();
  // A plain local, not state.data.x inside closures: the compiler would read that before data loads.
  const saved = state.data?.schedules;
  const schedules = saved ?? [];

  const now = localTime ? new Date(localTime * 1000) : null;
  const offNow =
    !!now &&
    !!saved &&
    radios.some((r) => wifiOffNow(saved, r.name, now.getUTCDay(), now.getUTCHours() * 60 + now.getUTCMinutes()));

  const summary = (s: WifiSchedule) =>
    t('wireless:schedule.summary', {
      off: t('wireless:schedule.offAt', { time: s.off }),
      on: t(minutesOf(s.on) > minutesOf(s.off) ? 'wireless:schedule.onAt' : 'wireless:schedule.onNextDay', {
        time: s.on,
      }),
    });

  return (
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
                  onPress={() => nav.push(`/wireless/edit/schedule?index=${index}`)}
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
            onPress={() => nav.push('/wireless/edit/schedule')}
            testID="wifi-schedule-add"
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
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  head: { gap: spacing.s },
});
