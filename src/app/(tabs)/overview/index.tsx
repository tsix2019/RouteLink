import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { isAvailable } from '@/api/capabilities';
import { pickWan } from '@/api/services/network';
import { DevicesCard, ResourcesCard, SystemCard, TrafficCard, WanCard } from '@/features/overview/cards';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
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
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';

export default function Overview() {
  const t = useT();
  const nav = useRouter();
  const { router } = useActiveRouter();
  const system = useSystem();
  const interfaces = useInterfaces();
  const clients = useClients();
  const caps = useCapabilities();
  const temperature = useTemperature(isAvailable(caps.data, 'system.temperature'));
  const traffic = useTraffic();
  const intervalSec = useSettings((s) => s.refreshIntervalSec);
  const saveSnapshot = useSnapshots((s) => s.save);
  const [confirmReboot, setConfirmReboot] = useState(false);
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

  const refresh = () => {
    void system.refetch();
    void interfaces.refetch();
    void clients.refetch();
  };

  return (
    <Screen
      refreshing={system.isRefetching}
      onRefresh={refresh}
      top={
        <ConnectionBanner
          error={system.error}
          onRetry={refresh}
          updatedAt={system.data ? system.dataUpdatedAt : undefined}
        />
      }>
      <TrafficCard series={traffic.series} latest={traffic.latest} intervalSec={intervalSec} />
      <DevicesCard clients={clients.data} />
      <WanCard wan={wan} loading={interfaces.isLoading} />
      <ResourcesCard system={system.data} temperature={temperature.data} />
      <SystemCard system={system.data} />
      <GlassCard title={t('overview:actions.title')} icon="bolt">
        <GlassButton
          label={t('overview:actions.reboot')}
          icon="power"
          variant="warning"
          onPress={() => setConfirmReboot(true)}
          testID="action-reboot"
        />
      </GlassCard>
      <RiskConfirm
        visible={confirmReboot}
        level="medium"
        disruptive
        title={t('overview:reboot.confirmTitle')}
        consequences={[t('overview:reboot.consequenceOffline'), t('overview:reboot.consequenceUnsaved')]}
        confirmLabel={t('overview:reboot.confirm')}
        onCancel={() => setConfirmReboot(false)}
        onConfirm={() => {
          setConfirmReboot(false);
          nav.push('/reboot');
        }}
      />
    </Screen>
  );
}
