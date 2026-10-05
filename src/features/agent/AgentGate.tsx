import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AgentInfo, AgentStatus } from '@/api/services/agent';
import { serviceAction } from '@/api/services/services';
import { AGENT_KEY, useAgentStatus } from '@/hooks/agent-queries';
import { useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

export const AGENT_PAGE = '/more/agent';

/** Restarts the plugin's service (rc init, or LuCI's init helper on 23.05). */
export function useRestartAgent() {
  const t = useT();
  const toast = useToast();
  const run = useRouterMutation((conn) => serviceAction(conn, 'routelink', 'restart'), [[AGENT_KEY]]);
  return {
    restart: () =>
      run.mutate(undefined, {
        onSuccess: () => toast(t('agent:restarted')),
        onError: (error) => toast(describeError(t, error).title, 'error'),
      }),
    pending: run.isPending,
  };
}

/** What to show instead of plugin data, per status (design §20). */
export function AgentPlaceholder({ status }: { status: Exclude<AgentStatus, { state: 'ok' }> }) {
  const t = useT();
  const nav = useRouter();
  const { restart } = useRestartAgent();
  switch (status.state) {
    case 'not-installed':
      return (
        <EmptyState
          icon="plugin"
          title={t('agent:gate.notInstalled.title')}
          message={t('agent:gate.notInstalled.message')}
          action={{ label: t('agent:gate.notInstalled.action'), onPress: () => nav.push(AGENT_PAGE) }}
        />
      );
    case 'not-running':
      return (
        <EmptyState
          icon="plugin"
          title={t('agent:gate.notRunning.title')}
          message={t('agent:gate.notRunning.message')}
          action={{ label: t('agent:gate.notRunning.action'), onPress: restart }}
        />
      );
    case 'too-old':
      return (
        <EmptyState
          icon="plugin"
          title={t('agent:gate.tooOld.title')}
          message={t('agent:gate.tooOld.message')}
          action={{ label: t('agent:gate.tooOld.action'), onPress: () => nav.push(AGENT_PAGE) }}
        />
      );
    case 'too-new':
      return <EmptyState icon="plugin" title={t('agent:gate.tooNew.title')} message={t('agent:gate.tooNew.message')} />;
    case 'no-permission':
      return (
        <EmptyState
          icon="lock"
          title={t('agent:gate.noPermission.title')}
          message={t('agent:gate.noPermission.message')}
        />
      );
  }
}

/** Renders `children` with the plugin's info when it is usable, a placeholder otherwise. */
export function AgentGate({ children }: { children: (info: AgentInfo) => ReactNode }) {
  const status = useAgentStatus();
  if (status.data?.state === 'ok') return <>{children(status.data.info)}</>;
  if (status.data) return <AgentPlaceholder status={status.data} />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  return (
    <View style={styles.loading}>
      <Skeleton height={36} radius={18} />
      <Skeleton height={120} radius={16} />
      <Skeleton height={180} radius={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
});
