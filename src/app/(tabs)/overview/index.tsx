import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { pickWan } from '@/api/services/network';
import { DevicesCard, ResourcesCard, SystemCard, TrafficCard, WanCard } from '@/features/overview/cards';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useRebootConfirm } from '@/features/routers/useRebootConfirm';
import { TodayTrafficCard } from '@/features/traffic/TodayTrafficCard';
import {
  useCapabilities,
  useClients,
  useInterfaces,
  useSystem,
  useTemperature,
  useTraffic,
} from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { updateWidgetFromApp } from '@/widgets/fromApp';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';
import { spacing } from '@/ui/theme/tokens';

export default function Overview() {
  const t = useT();
  const { router } = useActiveRouter();
  const system = useSystem();
  const interfaces = useInterfaces();
  const clients = useClients();
  const caps = useCapabilities();
  const temperature = useTemperature(isAvailable(caps.data, 'system.temperature'));
  const traffic = useTraffic();
  const intervalSec = useSettings((s) => s.refreshIntervalSec);
  const saveSnapshot = useSnapshots((s) => s.save);
  const reboot = useRebootConfirm();
  const nav = useRouter();
  const wan = pickWan(interfaces.data ?? []);

  // Keep the last good overview for cold starts, the router switcher and widgets.
  useEffect(() => {
    if (!router || !system.data) return;
    saveSnapshot(router.id, {
      model: system.data.model,
      firmware: system.data.firmware,
      hostname: system.data.hostname,
      uptimeSec: system.data.uptimeSec,
      wanUp: wan?.up,
      wanIp: wan?.ipv4[0]?.address,
      clientsOnline: clients.data?.filter((c) => c.online).length,
      clientsTotal: clients.data?.length,
    });
  }, [router, system.data, wan, clients.data, saveSnapshot]);

  // The home-screen widget follows the router on screen (it throttles itself).
  const online = !system.error && !!system.data;
  const devicesOnline = clients.data?.filter((c) => c.online).length;
  const latest = traffic.latest;
  useEffect(() => {
    if (!router || !system.data) return;
    updateWidgetFromApp(t, {
      name: router.isDemo ? t('demoRouter') : router.name,
      online,
      devicesOnline,
      rxBps: latest?.rxBps,
      txBps: latest?.txBps,
      updatedAt: Date.now(),
    });
  }, [router, system.data, online, devicesOnline, latest, t]);

  const refresh = () => Promise.all([system.refetch(), interfaces.refetch(), clients.refetch()]);

  return (
    <Screen
      title={t('tabs.overview')}
      headerLeft={<RouterSwitcherCapsule />}
      onRefresh={refresh}
      top={
        <ConnectionBanner
          error={system.error}
          onRetry={refresh}
          updatedAt={system.data ? system.dataUpdatedAt : undefined}
        />
      }>
      <TrafficCard series={traffic.series} latest={traffic.latest} intervalSec={intervalSec} />
      <TodayTrafficCard />
      <DevicesCard clients={clients.data} />
      <WanCard wan={wan} loading={!interfaces.data} />
      <ResourcesCard system={system.data} temperature={temperature.data} />
      <SystemCard system={system.data} />
      <GlassCard title={t('overview:actions.title')} icon="bolt" contentStyle={styles.actions}>
        {isAvailable(caps.data, 'wireless') ? (
          <GlassButton
            label={t('overview:actions.wifiQr')}
            icon="qrcode"
            onPress={() => nav.push('/wifi-qr')}
            testID="action-wifi-qr"
          />
        ) : null}
        <GlassButton
          label={t('assistant:ask')}
          icon="assistant"
          onPress={() => nav.push('/assistant')}
          testID="action-ask-ai"
        />
        <GlassButton
          label={t('overview:actions.reboot')}
          icon="power"
          variant="warning"
          onPress={reboot.open}
          testID="action-reboot"
        />
      </GlassCard>
      {reboot.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.s },
});
