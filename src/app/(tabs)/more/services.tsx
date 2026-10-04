import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isCritical, serviceAction, type Service, type ServiceAction } from '@/api/services/services';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useServices } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Badge, StatusDot } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type Pending = { service: Service; action: ServiceAction } | null;

/** Init scripts (rc list): state, boot flag, and start/stop/restart/enable/disable. */
export default function Services() {
  const t = useT();
  const toast = useToast();
  const services = useServices();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Service | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const run = useRouterMutation(
    (conn, a: { name: string; action: ServiceAction }) => serviceAction(conn, a.name, a.action),
    [['services']],
  );

  const label = (action: ServiceAction) => t(`more:servicesScreen.${action as 'start'}`);
  const execute = (service: Service, action: ServiceAction) =>
    run.mutate(
      { name: service.name, action },
      {
        onSuccess: () => toast(t('more:servicesScreen.done', { action: label(action), name: service.name })),
        onError: (error) => toast(describeError(t, error).title, 'error'),
      },
    );

  /** Starting and enabling are harmless; anything that stops a service is confirmed first. */
  const choose = (service: Service, action: ServiceAction) => {
    setSelected(null);
    if (action === 'start' || action === 'enable') execute(service, action);
    else setPending({ service, action });
  };

  const q = query.trim().toLowerCase();
  const list = (services.data ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));

  return (
    <>
      <Screen
        title={t('more:services')}
        refreshing={services.isRefetching}
        onRefresh={() => void services.refetch()}
        top={
          services.data ? <ConnectionBanner error={services.error} onRetry={() => void services.refetch()} /> : null
        }>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('more:servicesScreen.search')}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {services.data ? (
          list.length ? (
            <ListSection>
              {list.map((s) => (
                <ListRow
                  key={s.name}
                  title={s.name}
                  subtitle={[
                    s.running ? t('more:servicesScreen.running') : t('more:servicesScreen.stopped'),
                    s.enabled ? t('more:servicesScreen.enabled') : t('more:servicesScreen.disabled'),
                  ].join(' · ')}
                  left={<StatusDot status={s.running ? 'online' : 'offline'} />}
                  right={
                    isCritical(s.name) ? <Badge label={t('more:servicesScreen.core')} tone="warning" /> : undefined
                  }
                  chevron
                  onPress={() => setSelected(s)}
                  testID={`service-${s.name}`}
                />
              ))}
            </ListSection>
          ) : (
            <EmptyState icon="services" title={t('more:servicesScreen.empty')} />
          )
        ) : services.isError ? (
          <ErrorState error={services.error} onRetry={() => void services.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
      </Screen>

      <ActionSheet
        visible={!!selected}
        title={selected?.name}
        actions={
          selected
            ? [
                selected.running
                  ? { label: label('restart'), icon: 'refresh' as const, onPress: () => choose(selected, 'restart') }
                  : { label: label('start'), icon: 'power' as const, onPress: () => choose(selected, 'start') },
                ...(selected.running
                  ? [
                      {
                        label: label('stop'),
                        icon: 'block' as const,
                        destructive: true,
                        onPress: () => choose(selected, 'stop'),
                      },
                    ]
                  : []),
                selected.enabled
                  ? { label: label('disable'), destructive: true, onPress: () => choose(selected, 'disable') }
                  : { label: label('enable'), onPress: () => choose(selected, 'enable') },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending
            ? t('more:servicesScreen.confirmTitle', { action: label(pending.action), name: pending.service.name })
            : ''
        }
        consequences={[
          t('more:servicesScreen.consequence'),
          ...(pending && isCritical(pending.service.name) ? [t('more:servicesScreen.critical')] : []),
        ]}
        confirmLabel={pending ? label(pending.action) : ''}
        onConfirm={() => {
          if (pending) execute(pending.service, pending.action);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
