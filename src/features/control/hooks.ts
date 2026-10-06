import { agentQuotas } from '@/api/services/agent-control';
import { applyRules, getRules } from '@/api/services/agent-rules';
import type { UbusCall } from '@/api/ubus/types';
import { AGENT_KEY, useAgentStatus } from '@/hooks/agent-queries';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';

/** P4 module of the running plugin build (`info.capabilities`). */
export function usePluginModule(module: 'limits' | 'quotas' | 'dns' | 'notify') {
  const status = useAgentStatus();
  const info = status.data?.state === 'ok' ? status.data.info : undefined;
  return { info, supported: !!info?.capabilities.includes(module), loading: status.isLoading };
}

export const useRules = (enabled = true) => useRouterQuery([AGENT_KEY, 'rules'], getRules, { enabled });

export const useQuotaUsage = (enabled: boolean) =>
  useRouterQuery([AGENT_KEY, 'quotas'], agentQuotas, { enabled, refetchInterval: 30_000 });

/** Saves rule changes and refreshes everything the plugin shows (it reloads on the config change). */
export const useApplyRules = () =>
  useRouterMutation((conn, changes: UbusCall[]) => applyRules(conn, changes), [[AGENT_KEY]]);
