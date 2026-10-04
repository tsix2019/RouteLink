import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useInterfaces } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { formatDuration, protoLabel } from '@/utils/format';

/** Network tab: every logical interface with its state, address and traffic. */
export default function Network() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const interfaces = useInterfaces();

  return (
    <Screen
      title={t('tabs.network')}
      headerLeft={<RouterSwitcherCapsule />}
      refreshing={interfaces.isRefetching}
      onRefresh={() => void interfaces.refetch()}
      top={
        interfaces.data ? (
          <ConnectionBanner
            error={interfaces.error}
            onRetry={() => void interfaces.refetch()}
            updatedAt={interfaces.dataUpdatedAt}
          />
        ) : null
      }>
      {interfaces.data ? (
        interfaces.data.length ? (
          <ListSection title={t('network:interfaces')}>
            {interfaces.data.map((i) => {
              const first = i.ipv4[0] ?? i.ipv6[0];
              const subtitle = [
                protoLabel(i.proto, lang),
                i.up ? (first ? `${first.address}/${first.mask}` : t('network:noAddress')) : t('network:down'),
              ];
              return (
                <ListRow
                  key={i.name}
                  title={i.name.toUpperCase()}
                  subtitle={subtitle.join(' · ')}
                  value={i.up ? formatDuration(i.uptimeSec, lang) : undefined}
                  left={<StatusDot status={i.up ? 'online' : i.errors.length ? 'warning' : 'offline'} />}
                  chevron
                  onPress={() => nav.push(`/network/${encodeURIComponent(i.name)}`)}
                  testID={`iface-${i.name}`}
                />
              );
            })}
          </ListSection>
        ) : (
          <EmptyState icon="network" title={t('network:empty')} />
        )
      ) : interfaces.isError ? (
        <ErrorState error={interfaces.error} onRetry={() => void interfaces.refetch()} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={52} radius={14} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
