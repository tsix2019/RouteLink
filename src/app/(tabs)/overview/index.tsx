import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { pickWan } from '@/api/services/network';
import { loadRatio } from '@/api/services/system';
import { LiveMonitorButton, LiveMonitorNotice } from '@/features/live/LiveMonitor';
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
import { takePendingRoute } from '@/widgets/links';
import { deviceSummary } from '@/widgets/read';
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

  // The home-screen widgets follow the router on screen (they throttle themselves).
  const online = !system.error && !!system.data;
  const latest = traffic.latest;
  useEffect(() => {
    if (!router || !system.data) return;
    const s = system.data;
    updateWidgetFromApp({
      name: router.isDemo ? t('demoRouter') : router.name,
      online,
      // Without a saved password only the app can log in: the widgets' ↻ opens it instead.
      refreshable: router.isDemo || !!router.profile?.savePassword,
      ...(clients.data ? deviceSummary(clients.data) : {}),
      rxBps: latest?.rxBps,
      txBps: latest?.txBps,
      cpu: loadRatio(s) ?? undefined,
      memory: s.memory.total ? s.memory.used / s.memory.total : undefined,
      temperature: typeof temperature.data === 'number' ? temperature.data : undefined,
      uptimeSec: s.uptimeSec,
      wanUp: wan?.up,
      wanIp: wan?.ipv4[0]?.address,
      wanProto: wan?.proto,
      updatedAt: Date.now(),
    });
  }, [router, system.data, online, clients.data, latest, temperature.data, wan, t]);

  // A widget button opened the app cold on a sheet (Wi-Fi QR, terminal, assistant): it opens over this page.
  useEffect(() => {
    const route = takePendingRoute();
    if (route) nav.push(route as Parameters<typeof nav.push>[0]);
  }, [nav]);

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
      <LiveMonitorNotice />
      <TrafficCard series={traffic.series} latest={traffic.latest} intervalSec={intervalSec} />
      <TodayTrafficCard />
      <DevicesCard clients={clients.data} />
      <WanCard wan={wan} loading={!interfaces.data} />
      <ResourcesCard system={system.data} temperature={temperature.data} />
      <SystemCard system={system.data} />
      <GlassCard title={t('overview:actions.title')} icon="bolt" contentStyle={styles.actions}>
        <LiveMonitorButton
          latest={traffic.latest}
          devicesOnline={clients.data?.filter((c) => c.online).length}
          clients={clients.data}
          wanDevice={wan?.device}
        />
        <GlassButton
          label={t('diagnostics:entries.diagnose')}
          icon="pulse"
          onPress={() => nav.navigate('/network/diagnostics', { withAnchor: true })}
          testID="action-diagnose"
        />
        {isAvailable(caps.data, 'wireless') ? (
          <GlassButton
            label={t('overview:actions.wifiQr')}
            icon="qrcode"
            onPress={() => nav.push('/wifi-qr')}
            testID="action-wifi-qr"
          />
        ) : null}
        {isAvailable(caps.data, 'wireless') ? (
          <GlassButton
            label={t('devices:intruders')}
            icon="shield"
            onPress={() => nav.navigate('/devices/intruders')}
            testID="action-intruders"
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
