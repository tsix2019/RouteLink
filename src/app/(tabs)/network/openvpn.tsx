import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouterConnection } from '@/api/connection/types';
import { deleteInstance, getOpenvpn, setInstanceEnabled, type OvpnInstance } from '@/api/services/openvpn';
import type { ApplyOutcome } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type Pending = { title: string; run(conn: RouterConnection): Promise<ApplyOutcome> };

/** NW-8: OpenVPN client profiles — start and stop, delete; imported on their own page. */
export default function OpenVpn() {
  const t = useT();
  const toast = useToast();
  const state = useRouterQuery(['openvpn'], getOpenvpn, { refetchInterval: 10_000 });
  const nav = useRouter();
  const [menu, setMenu] = useState<OvpnInstance | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useRouterMutation((conn, p: Pending) => p.run(conn), [['openvpn']]);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');

  const status = (i: OvpnInstance) =>
    i.running === null
      ? i.enabled
        ? t('network:openvpn.unknown')
        : t('network:openvpn.stopped')
      : i.running
        ? t('network:openvpn.running')
        : t('network:openvpn.stopped');

  const data = state.data;
  return (
    <>
      <Screen
        title={t('network:openvpn.title')}
        onRefresh={() => state.refetch()}
        top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        <FeatureGate feature="network.openvpn" icon="vpn">
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:openvpn.intro')}
          </AppText>
          {data ? (
            <>
              <ListSection
                footer={data.instances.some((i) => i.running === null) ? t('network:openvpn.statusHint') : undefined}>
                {data.instances.length ? (
                  data.instances.map((i) => (
                    <ListRow
                      key={i.name}
                      title={i.name}
                      subtitle={[status(i), i.hasLogin ? t('network:openvpn.login') : null].filter(Boolean).join(' · ')}
                      left={<StatusDot status={i.running ? 'online' : 'offline'} />}
                      switchValue={i.enabled}
                      onSwitch={(on) =>
                        setPending({
                          title: t(on ? 'network:openvpn.enableTitle' : 'network:openvpn.disableTitle', {
                            name: i.name,
                          }),
                          run: (conn) => setInstanceEnabled(conn, i, on),
                        })
                      }
                      onPress={() => setMenu(i)}
                      testID={`ovpn-${i.name}`}
                    />
                  ))
                ) : (
                  <ListRow title={t('network:openvpn.empty')} disabled />
                )}
              </ListSection>
              <GlassButton
                label={t('network:openvpn.import')}
                icon="import"
                variant="primary"
                disabled={run.isPending}
                onPress={() => nav.push('/network/edit/openvpn')}
                testID="ovpn-import"
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
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        message={menu?.configFile}
        actions={
          menu
            ? [
                {
                  label: t('network:openvpn.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    const i = menu;
                    setMenu(null);
                    setPending({
                      title: t('network:openvpn.deleteTitle', { name: i.name }),
                      run: (conn) => deleteInstance(conn, i),
                    });
                  },
                },
              ]
            : []
        }
        onCancel={() => setMenu(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[t('network:openvpn.consequence')]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          run.mutate(p, {
            onSuccess: (outcome) =>
              outcome.status === 'rolled-back'
                ? toast(t('network:result.rolledBack'), 'warning')
                : toast(t('network:openvpn.applied')),
            onError: fail,
          });
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
});
