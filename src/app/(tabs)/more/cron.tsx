import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { describeSchedule, readCrontab, type CronEntry } from '@/api/services/cron';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterQuery } from '@/hooks/router-queries';
import { currentLanguage, useT } from '@/i18n';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';

/**
 * MO-6: the root crontab, each task edited on its own page. Comments and odd lines stay as they are;
 * App-managed tasks are read-only.
 */
export default function ScheduledTasks() {
  const t = useT();
  const nav = useRouter();
  const tab = useRouterQuery(['cron'], readCrontab);
  const lines = tab.data?.lines ?? [];
  const entries = lines.flatMap((l, index) => (l.kind === 'entry' ? [{ entry: l, index }] : []));
  const lang = currentLanguage();
  const describe = (e: CronEntry) => describeSchedule(e.schedule, lang) ?? e.schedule.join(' ');

  return (
    <Screen
      title={t('more:cron')}
      onRefresh={() => tab.refetch()}
      top={tab.data ? <ConnectionBanner error={tab.error} onRetry={() => void tab.refetch()} /> : null}>
      <FeatureGate feature="system.cron" icon="schedule">
        {tab.data ? (
          entries.length ? (
            <ListSection footer={entries.some((e) => e.entry.managed) ? t('more:cronScreen.managedHint') : undefined}>
              {entries.map(({ entry, index }) => (
                <ListRow
                  key={index}
                  title={entry.command}
                  subtitle={describe(entry)}
                  icon="schedule"
                  right={entry.managed ? <Badge label={t('more:cronScreen.managed')} tone="accent" /> : undefined}
                  chevron={!entry.managed}
                  onPress={entry.managed ? undefined : () => nav.push(`/more/edit/cron?index=${index}`)}
                  testID={`cron-${index}`}
                />
              ))}
            </ListSection>
          ) : (
            <EmptyState icon="schedule" title={t('more:cronScreen.empty')} message={t('more:cronScreen.emptyHint')} />
          )
        ) : tab.isError ? (
          <ErrorState error={tab.error} onRetry={() => void tab.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
        {tab.data ? (
          <GlassButton
            label={t('more:cronScreen.add')}
            icon="plus"
            variant="primary"
            onPress={() => nav.push('/more/edit/cron')}
            testID="cron-add"
          />
        ) : null}
      </FeatureGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
