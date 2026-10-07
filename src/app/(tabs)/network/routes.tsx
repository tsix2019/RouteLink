import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getRoutes, type Family, type KernelRoute } from '@/api/services/routes';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { Segmented } from '@/ui/Segmented';

/** NW-4: the kernel's routing tables and the static routes in the network configuration. */
export default function Routes() {
  const t = useT();
  const nav = useRouter();
  const routes = useRouterQuery(['routes'], getRoutes);
  const [family, setFamily] = useState<Family>(4);
  const [showLocal, setShowLocal] = useState(false);

  const statics = (routes.data?.statics ?? []).filter((r) => r.family === family);
  const kernel = (routes.data?.kernel ?? []).filter((r) => r.family === family && (showLocal || r.table !== 'local'));
  const tables = [...new Set(kernel.map((r) => r.table))].sort((a, b) =>
    a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b),
  );

  const detail = (r: KernelRoute) =>
    [
      r.type !== 'unicast' ? r.type : null,
      r.via ? t('network:routes.via', { gateway: r.via }) : null,
      r.dev ? t('network:routes.device', { device: r.dev }) : null,
      r.metric !== undefined ? t('network:routes.metric', { metric: r.metric }) : null,
      r.proto,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen
      title={t('network:routes.title')}
      onRefresh={() => routes.refetch()}
      top={routes.data ? <ConnectionBanner error={routes.error} onRetry={() => void routes.refetch()} /> : null}>
      <FeatureGate feature="network.routes" icon="route">
        <Segmented
          values={['IPv4', 'IPv6']}
          selectedIndex={family === 4 ? 0 : 1}
          onChange={(e) => setFamily(e.nativeEvent.selectedSegmentIndex === 0 ? 4 : 6)}
        />
        {routes.data ? (
          <>
            <ListSection title={t('network:routes.static')} footer={t('network:routes.staticHint')}>
              {statics.length ? (
                statics.map((r) => (
                  <ListRow
                    key={r.section}
                    title={r.target}
                    subtitle={[
                      r.gateway ? t('network:routes.via', { gateway: r.gateway }) : null,
                      r.interface,
                      r.metric ? t('network:routes.metric', { metric: r.metric }) : null,
                      r.table ? t('network:routes.table', { table: r.table }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={r.disabled ? <Badge label={t('network:routes.disabled')} /> : undefined}
                    chevron
                    onPress={() => nav.push(`/network/edit/route?section=${encodeURIComponent(r.section)}`)}
                    testID={`route-${r.section}`}
                  />
                ))
              ) : (
                <ListRow title={t('network:routes.empty')} disabled />
              )}
            </ListSection>
            <GlassButton
              label={t('network:routes.add')}
              icon="plus"
              onPress={() => nav.push(`/network/edit/route?family=${family}`)}
              testID="route-add"
            />
            {tables.map((table) => (
              <ListSection
                key={table}
                title={table === 'main' ? t('network:routes.kernel') : t('network:routes.table', { table })}>
                {kernel
                  .filter((r) => r.table === table)
                  .map((r, i) => (
                    <ListRow key={`${r.target}-${i}`} title={r.target} subtitle={detail(r)} />
                  ))}
              </ListSection>
            ))}
            <ListSection>
              <ListRow title={t('network:routes.showLocal')} switchValue={showLocal} onSwitch={setShowLocal} />
            </ListSection>
          </>
        ) : routes.isError ? (
          <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
      </FeatureGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
