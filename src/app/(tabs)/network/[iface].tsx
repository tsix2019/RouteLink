import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { reconnectInterface } from '@/api/services/network';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { hostOf } from '@/features/routers/login';
import { useDeviceCounters, useInterfaces, useRouterMutation } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { InfoGrid } from '@/ui/InfoGrid';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { HeaderButton, Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes, formatDuration, formatLinkSpeed, protoLabel } from '@/utils/format';

/** One interface in full, with a reconnect (ifdown + ifup) at the bottom. */
export default function InterfaceScreen() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { iface } = useLocalSearchParams<{ iface: string }>();
  const nav = useRouter();
  const { router } = useActiveRouter();
  const interfaces = useInterfaces();
  const counters = useDeviceCounters();
  const [confirming, setConfirming] = useState(false);
  const reconnect = useRouterMutation((conn, name: string) => reconnectInterface(conn, name), [['interfaces']]);

  const i = interfaces.data?.find((x) => x.name === iface);
  const title = (iface ?? '').toUpperCase();
  if (!i) {
    return (
      <Screen title={title}>
        {interfaces.isError ? (
          <ErrorState error={interfaces.error} onRetry={() => void interfaces.refetch()} />
        ) : (
          <View style={styles.loading}>
            <Skeleton height={120} radius={22} />
            <Skeleton height={160} radius={22} />
          </View>
        )}
      </Screen>
    );
  }

  const c = i.device ? counters.data?.[i.device] : undefined;
  // The app reaches the router at one of this interface's addresses: reconnecting cuts it off briefly.
  const servesApp = !!router && !router.isDemo && i.ipv4.some((a) => a.address === hostOf(router.baseUrl));

  const editable = i.name === 'lan' || i.name === 'wan';

  return (
    <>
      <Screen
        title={title}
        headerRight={
          editable ? (
            <HeaderButton
              icon="edit"
              accessibilityLabel={t('network:edit.button')}
              onPress={() => nav.push(`/network/edit/${i.name}`)}
              testID="interface-edit"
            />
          ) : undefined
        }>
        <GlassCard
          title={t('network:detail.status')}
          icon="network"
          accessory={<StatusDot status={i.up ? 'online' : 'offline'} />}>
          <InfoGrid
            items={[
              {
                label: t('network:detail.status'),
                value: i.up ? t('network:detail.connected') : t('network:detail.disconnected'),
              },
              { label: t('network:detail.protocol'), value: protoLabel(i.proto, lang) },
              { label: t('network:detail.device'), value: i.device },
              { label: t('network:detail.uptime'), value: i.up ? formatDuration(i.uptimeSec, lang) : undefined },
              {
                label: t('network:detail.errors'),
                value: i.errors.length ? i.errors.join(', ') : undefined,
                wide: true,
              },
            ]}
          />
        </GlassCard>
        <GlassCard title={t('network:detail.addresses')} icon="globe">
          <InfoGrid
            items={[
              {
                label: t('network:detail.ipv4'),
                value: i.ipv4.map((a) => `${a.address}/${a.mask}`).join('\n') || undefined,
                wide: true,
                selectable: true,
              },
              {
                label: t('network:detail.ipv6'),
                value: i.ipv6.map((a) => `${a.address}/${a.mask}`).join('\n') || undefined,
                wide: true,
                selectable: true,
              },
              { label: t('network:detail.gateway'), value: i.gateway, selectable: true },
              { label: t('network:detail.dns'), value: i.dns.join(', ') || undefined, wide: true, selectable: true },
            ]}
          />
        </GlassCard>
        {c ? (
          <GlassCard title={t('network:detail.trafficTitle')} icon="bolt">
            <InfoGrid
              items={[
                { label: t('network:detail.received'), value: formatBytes(c.rx) },
                { label: t('network:detail.sent'), value: formatBytes(c.tx) },
                { label: t('network:detail.speed'), value: c.speedMbps ? formatLinkSpeed(c.speedMbps) : undefined },
              ]}
            />
          </GlassCard>
        ) : null}
        <GlassButton
          label={t('network:reconnect.button')}
          icon="refresh"
          variant="warning"
          loading={reconnect.isPending}
          disabled={reconnect.isPending}
          onPress={() => setConfirming(true)}
          testID="iface-reconnect"
        />
      </Screen>
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('network:reconnect.title', { name: title })}
        consequences={[
          t('network:reconnect.consequence'),
          ...(i.proto === 'pppoe' ? [t('network:reconnect.pppoe')] : []),
          ...(servesApp ? [t('network:reconnect.appConsequence')] : []),
        ]}
        confirmLabel={t('network:reconnect.button')}
        onConfirm={() => {
          setConfirming(false);
          reconnect.mutate(i.name, {
            onSuccess: () => toast(t('network:reconnect.done')),
            onError: (error) => toast(describeError(t, error).title, 'error'),
          });
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
});
