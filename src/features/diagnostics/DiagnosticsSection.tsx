import { useRouter } from 'expo-router';

import { AGENT_PAGE } from '@/features/agent/AgentGate';
import { useAgentStatus } from '@/hooks/agent-queries';
import { useT } from '@/i18n';
import { ListRow, ListSection } from '@/ui/ListSection';

/**
 * "Diagnostics" in the Network tab (T12): one-tap diagnosis, the tools, outages and latency, speed test.
 * Outages and latency need the plugin's probes; without them the row says so and opens the plugin page.
 */
export function DiagnosticsSection() {
  const t = useT();
  const nav = useRouter();
  const status = useAgentStatus();
  const info = status.data?.state === 'ok' ? status.data.info : null;
  const latencyHint = !status.data
    ? undefined
    : !info
      ? t('diagnostics:entries.needsPlugin')
      : !info.capabilities.includes('latency')
        ? t('diagnostics:entries.pluginTooOld')
        : undefined;

  return (
    <ListSection title={t('diagnostics:entries.section')}>
      <ListRow
        title={t('diagnostics:entries.diagnose')}
        subtitle={t('diagnostics:entries.diagnoseHint')}
        icon="pulse"
        chevron
        onPress={() => nav.push('/network/diagnostics')}
        testID="network-diagnose"
      />
      <ListRow
        title={t('diagnostics:entries.tools')}
        subtitle={t('diagnostics:entries.toolsHint')}
        icon="terminal"
        chevron
        onPress={() => nav.push('/network/diagnostics/tools')}
        testID="network-diag-tools"
      />
      <ListRow
        title={t('diagnostics:entries.latency')}
        subtitle={latencyHint}
        icon="timer"
        chevron
        onPress={() =>
          latencyHint ? nav.push(AGENT_PAGE, { withAnchor: true }) : nav.push('/network/diagnostics/latency')
        }
        testID="network-latency"
      />
      <ListRow
        title={t('diagnostics:entries.speed')}
        icon="speed"
        chevron
        onPress={() => nav.push('/network/diagnostics/speed')}
        testID="network-speedtest"
      />
    </ListSection>
  );
}
