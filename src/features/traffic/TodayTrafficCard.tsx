import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AGENT_PAGE } from '@/features/agent/AgentGate';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useAgentStatus, useTrafficSummary } from '@/hooks/agent-queries';
import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBytes } from '@/utils/format';

import { useDeviceLabels } from './labels';

/** Today so far, refreshed once a minute (a new end time is a new query). */
function today(): { start: number; end: number } {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start: Math.floor(midnight.getTime() / 1000), end: Math.floor(now.getTime() / 60_000) * 60 };
}

/** Overview card (design TR entry points): today's totals and top devices, or an invitation to install. */
export function TodayTrafficCard() {
  const status = useAgentStatus();
  if (status.data?.state === 'ok') return <TodayTotals />;
  if (status.data?.state === 'not-installed') return <InstallInvite />;
  return null;
}

function TodayTotals() {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const label = useDeviceLabels();
  const range = today();
  const summary = useTrafficSummary({ ...range, limit: 3 });
  const s = summary.data;
  return (
    <Pressable accessibilityRole="button" onPress={() => nav.navigate('/network/traffic', { withAnchor: true })} testID="card-today-traffic">
      <GlassCard
        title={t('traffic:card.title')}
        icon="chart"
        accessory={<Icon name="chevronRight" size={16} color={colors.textTertiary} />}>
        {s ? (
          <>
            <View style={styles.totals}>
              <AppText variant="title" style={{ color: colors.chartDown }}>{`↓ ${formatBytes(s.rx)}`}</AppText>
              <AppText variant="title" style={{ color: colors.chartUp }}>{`↑ ${formatBytes(s.tx)}`}</AppText>
            </View>
            {s.devices.length ? (
              <View style={styles.top}>
                <AppText variant="footnote" tone="secondary">
                  {t('traffic:card.top')}
                </AppText>
                {s.devices.map((d) => (
                  <View key={d.mac} style={styles.topRow}>
                    <Icon name={label(d.mac).icon} size={15} color={colors.textSecondary} />
                    <AppText variant="subhead" numberOfLines={1} style={styles.topName}>
                      {label(d.mac).name}
                    </AppText>
                    <AppText variant="subhead" tone="secondary">
                      {formatBytes(d.rx + d.tx)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Skeleton height={56} radius={12} />
        )}
      </GlassCard>
    </Pressable>
  );
}

function InstallInvite() {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const { router } = useActiveRouter();
  const dismissed = useSettings((s) => !!router && s.dismissedAgentCard.includes(router.id));
  const dismiss = useSettings((s) => s.dismissAgentCard);
  if (!router || dismissed) return null;
  return (
    <GlassCard
      title={t('traffic:card.title')}
      icon="plugin"
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('traffic:card.dismiss')}
          hitSlop={10}
          onPress={() => dismiss(router.id)}>
          <Icon name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      }
      testID="card-agent-invite">
      <AppText variant="subhead" tone="secondary">
        {t('traffic:card.install')}
      </AppText>
      <GlassButton
        label={t('traffic:card.installAction')}
        icon="download"
        compact
        onPress={() => nav.push(AGENT_PAGE)}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: spacing.xl },
  top: { gap: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  topName: { flex: 1 },
});
