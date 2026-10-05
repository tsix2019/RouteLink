import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  deleteStaticRoute,
  getRoutes,
  saveStaticRoute,
  type Family,
  type KernelRoute,
  type StaticRoute,
  type StaticRouteInput,
} from '@/api/services/routes';
import type { ApplyOutcome } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { RouteSheet } from '@/features/network/RouteSheet';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useInterfaces, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type Pending = { kind: 'save'; input: StaticRouteInput; route?: StaticRoute } | { kind: 'delete'; route: StaticRoute };

/** NW-4: the kernel's routing tables and the static routes in the network configuration. */
export default function Routes() {
  const t = useT();
  const toast = useToast();
  const routes = useRouterQuery(['routes'], getRoutes);
  const interfaces = useInterfaces();
  const [family, setFamily] = useState<Family>(4);
  const [showLocal, setShowLocal] = useState(false);
  const [selected, setSelected] = useState<StaticRoute | null>(null);
  const [editing, setEditing] = useState<{ route?: StaticRoute } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const report = (outcome: ApplyOutcome) =>
    outcome.status === 'rolled-back'
      ? toast(t('network:result.rolledBack'), 'warning')
      : toast(t('network:result.applied'));
  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');
  const save = useRouterMutation(
    (conn, a: { input: StaticRouteInput; route?: StaticRoute }) => saveStaticRoute(conn, a.input, a.route),
    [['routes']],
  );
  const remove = useRouterMutation((conn, route: StaticRoute) => deleteStaticRoute(conn, route), [['routes']]);

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
    <>
      <Screen
        title={t('network:routes.title')}
        onRefresh={() => routes.refetch()}
        top={routes.data ? <ConnectionBanner error={routes.error} onRetry={() => void routes.refetch()} /> : null}>
        <FeatureGate feature="network.routes" icon="route">
          <SegmentedControl
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
                      onPress={() => setSelected(r)}
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
                onPress={() => setEditing({})}
                disabled={save.isPending || remove.isPending}
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

      <ActionSheet
        visible={!!selected}
        title={selected?.target}
        actions={
          selected
            ? [
                {
                  label: t('network:routes.edit'),
                  icon: 'edit' as const,
                  onPress: () => {
                    setEditing({ route: selected });
                    setSelected(null);
                  },
                },
                {
                  label: t('network:routes.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    setPending({ kind: 'delete', route: selected });
                    setSelected(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      {editing ? (
        <RouteSheet
          route={editing.route}
          family={family}
          interfaces={(interfaces.data ?? []).filter((i) => i.name !== 'loopback')}
          onSave={(input) => {
            setPending({ kind: 'save', input, route: editing.route });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending?.kind === 'delete'
            ? t('network:routes.deleteTitle', { target: pending.route.target })
            : t('network:routes.saveTitle')
        }
        consequences={[t('network:routes.consequence')]}
        confirmLabel={pending?.kind === 'delete' ? t('network:routes.delete') : t('save')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p?.kind === 'save') save.mutate({ input: p.input, route: p.route }, { onSuccess: report, onError: fail });
          if (p?.kind === 'delete') remove.mutate(p.route, { onSuccess: report, onError: fail });
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
