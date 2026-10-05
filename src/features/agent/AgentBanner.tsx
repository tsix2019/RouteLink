import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AgentInfo } from '@/api/services/agent';
import { serviceAction } from '@/api/services/services';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** Warnings above plugin data: counters off, offloading, unsynced clock, nlbwmon zeroing counters. */
export function AgentBanner({ info }: { info: AgentInfo }) {
  const t = useT();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const stop = useRouterMutation(
    async (conn) => {
      await serviceAction(conn, 'nlbwmon', 'stop');
      await serviceAction(conn, 'nlbwmon', 'disable');
    },
    [[AGENT_KEY], ['services']],
  );
  const banners = [
    !info.conntrackAccounting ? <Banner key="acct" tone="warning" text={t('agent:banner.accounting')} /> : null,
    info.offloadWarning ? <Banner key="offload" tone="info" text={t('agent:banner.offload')} /> : null,
    !info.timeSynced ? <Banner key="time" tone="warning" text={t('agent:banner.time')} /> : null,
    info.nlbwmonRunning ? (
      <Banner
        key="nlbwmon"
        tone="warning"
        text={t('agent:banner.nlbwmon')}
        action={{ label: t('agent:banner.nlbwmonAction'), onPress: () => setConfirm(true) }}
      />
    ) : null,
  ].filter(Boolean);
  if (!banners.length) return null;
  return (
    <View style={styles.list}>
      {banners}
      <RiskConfirm
        visible={confirm}
        level="medium"
        title={t('agent:nlbwmon.title')}
        consequences={[t('agent:nlbwmon.consequences.stops'), t('agent:nlbwmon.consequences.undo')]}
        confirmLabel={t('agent:nlbwmon.confirm')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          stop.mutate(undefined, { onError: (error) => toast(describeError(t, error).title, 'error') });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.s },
});
