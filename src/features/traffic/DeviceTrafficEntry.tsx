import { useRouter } from 'expo-router';

import { AGENT_PAGE } from '@/features/agent/AgentGate';
import { useAgentDevices, useAgentStatus } from '@/hooks/agent-queries';
import { useT } from '@/i18n';
import { ListRow, ListSection } from '@/ui/ListSection';
import { formatBytes } from '@/utils/format';

/** "Traffic" row in the device sheet: today's usage, opening the device's traffic page. */
export function DeviceTrafficEntry({ mac }: { mac: string }) {
  const t = useT();
  const nav = useRouter();
  const status = useAgentStatus();
  const ok = status.data?.state === 'ok';
  const device = useAgentDevices(ok).data?.find((d) => d.mac === mac);
  if (!status.data) return null;
  return (
    <ListSection>
      {ok ? (
        <ListRow
          icon="chart"
          title={t('traffic:device.row')}
          subtitle={
            device
              ? t('traffic:device.today', { rx: formatBytes(device.today.rx), tx: formatBytes(device.today.tx) })
              : undefined
          }
          chevron
          onPress={() => nav.navigate(`/network/traffic/${encodeURIComponent(mac)}`, { withAnchor: true })}
          testID="device-traffic"
        />
      ) : (
        <ListRow
          icon="chart"
          title={t('traffic:device.row')}
          subtitle={t('traffic:device.needsPlugin')}
          chevron
          onPress={() => nav.navigate(AGENT_PAGE, { withAnchor: true })}
          testID="device-traffic"
        />
      )}
    </ListSection>
  );
}
