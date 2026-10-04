import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import type { NetInterface } from '@/api/services/network';
import type { SystemSnapshot } from '@/api/services/system';
import { loadRatio } from '@/api/services/system';
import type { RatePoint } from '@/api/services/traffic';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { TrafficChart } from '@/ui/charts/AreaChart';
import { RingGauge } from '@/ui/charts/RingGauge';
import { Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { InfoGrid } from '@/ui/InfoGrid';
import { StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBitRate, formatBytes, formatDuration, formatPercent, protoLabel } from '@/utils/format';

const routerClock = (epochSec: number, lang: 'zh-CN' | 'en') =>
  // localtime is already shifted to the router's zone; format it as UTC to keep that wall time.
  new Date(epochSec * 1000).toLocaleString(lang, { timeZone: 'UTC', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === 0 ? '60%' : '100%'} />
      ))}
    </View>
  );
}

export function SystemCard({ system }: { system?: SystemSnapshot }) {
  const t = useT();
  const lang = useLang();
  return (
    <GlassCard title={t('overview:system.title')} icon="router" testID="card-system">
      {system ? (
        <InfoGrid
          items={[
            { label: t('overview:system.model'), value: system.model, wide: true },
            { label: t('overview:system.firmware'), value: system.firmware, wide: true },
            { label: t('overview:system.hostname'), value: system.hostname },
            { label: t('overview:system.kernel'), value: system.kernel },
            { label: t('overview:system.uptime'), value: formatDuration(system.uptimeSec, lang) },
            { label: t('overview:system.time'), value: system.localTime ? routerClock(system.localTime, lang) : undefined },
          ]}
        />
      ) : (
        <CardSkeleton lines={4} />
      )}
    </GlassCard>
  );
}

export function ResourcesCard({ system, temperature }: { system?: SystemSnapshot; temperature?: number | null }) {
  const t = useT();
  if (!system) {
    return (
      <GlassCard title={t('overview:resources.title')} icon="cpu">
        <CardSkeleton />
      </GlassCard>
    );
  }
  const ratio = loadRatio(system);
  const mem = system.memory.total ? system.memory.used / system.memory.total : 0;
  const root = system.storage.root;
  const disk = root?.total ? root.used / root.total : null;
  return (
    <GlassCard
      title={t('overview:resources.title')}
      icon="cpu"
      subtitle={system.cpuCores ? t('overview:resources.cores', { count: system.cpuCores }) : undefined}
      testID="card-resources">
      <View style={styles.rings}>
        <RingGauge value={ratio} centerText={system.load[0].toFixed(2)} label={t('overview:resources.load')} />
        <RingGauge value={mem} centerText={formatPercent(mem)} label={t('overview:resources.memory')} />
        {disk !== null ? <RingGauge value={disk} centerText={formatPercent(disk)} label={t('overview:resources.storage')} /> : null}
      </View>
      <AppText variant="footnote" tone="secondary">
        {t('overview:resources.loadDetail', { l1: system.load[0].toFixed(2), l5: system.load[1].toFixed(2), l15: system.load[2].toFixed(2) })}
      </AppText>
      <AppText variant="footnote" tone="secondary">
        {`${t('overview:resources.memory')} · ${t('overview:resources.used', { used: formatBytes(system.memory.used), total: formatBytes(system.memory.total) })}`}
      </AppText>
      {typeof temperature === 'number' ? (
        <AppText variant="footnote" tone="secondary">{`${t('overview:resources.temperature')} · ${temperature.toFixed(1)} °C`}</AppText>
      ) : null}
    </GlassCard>
  );
}

export function WanCard({ wan, loading }: { wan?: NetInterface; loading: boolean }) {
  const t = useT();
  const lang = useLang();
  return (
    <GlassCard
      title={t('overview:wan.title')}
      icon="globe"
      accessory={
        wan ? (
          <View style={styles.status}>
            <StatusDot status={wan.up ? 'online' : 'offline'} />
            <AppText variant="footnote" tone="secondary">
              {`${wan.up ? t('overview:wan.connected') : t('overview:wan.disconnected')} · ${protoLabel(wan.proto, lang)}`}
            </AppText>
          </View>
        ) : undefined
      }
      testID="card-wan">
      {wan ? (
        <InfoGrid
          items={[
            { label: t('overview:wan.ipv4'), value: wan.ipv4[0]?.address, selectable: true },
            { label: t('overview:wan.gateway'), value: wan.gateway, selectable: true },
            { label: t('overview:wan.ipv6'), value: wan.ipv6[0] ? `${wan.ipv6[0].address}/${wan.ipv6[0].mask}` : undefined, wide: true, selectable: true },
            { label: t('overview:wan.dns'), value: wan.dns.join(', ') || undefined, wide: true },
            { label: t('overview:wan.uptime'), value: wan.up ? formatDuration(wan.uptimeSec, lang) : undefined },
          ]}
        />
      ) : loading ? (
        <CardSkeleton />
      ) : (
        <AppText variant="subhead" tone="secondary">
          {t('overview:wan.none')}
        </AppText>
      )}
    </GlassCard>
  );
}

export function TrafficCard({ series, latest, intervalSec }: { series: readonly RatePoint[]; latest?: RatePoint; intervalSec: number }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <GlassCard title={t('overview:traffic.title')} icon="down" subtitle={t('overview:traffic.interval', { seconds: intervalSec })} testID="card-traffic">
      <View style={styles.legend}>
        <Legend color={colors.chartDown} label={t('overview:traffic.down')} value={latest ? formatBitRate(latest.rxBps) : '—'} icon="down" />
        <Legend color={colors.chartUp} label={t('overview:traffic.up')} value={latest ? formatBitRate(latest.txBps) : '—'} icon="up" />
      </View>
      <TrafficChart series={series} />
      {series.length < 2 ? (
        <AppText variant="footnote" tone="tertiary">
          {t('overview:traffic.collecting')}
        </AppText>
      ) : null}
    </GlassCard>
  );
}

function Legend({ color, label, value, icon }: { color: string; label: string; value: string; icon: 'down' | 'up' }) {
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendLabel}>
        <Icon name={icon} size={14} color={color} />
        <AppText variant="footnote" tone="secondary">
          {label}
        </AppText>
      </View>
      <AppText variant="title" style={{ color }}>
        {value}
      </AppText>
    </View>
  );
}

export function DevicesCard({ clients }: { clients?: Client[] }) {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const online = clients?.filter((c) => c.online) ?? [];
  return (
    <Pressable accessibilityRole="button" onPress={() => router.navigate('/devices')} testID="card-devices">
      <GlassCard title={t('overview:devices.title')} icon="devices" accessory={<Icon name="chevronRight" size={16} color={colors.textTertiary} />}>
        {clients ? (
          <View style={styles.devices}>
            <AppText variant="largeTitle">{online.length}</AppText>
            <View style={styles.devicesDetail}>
              <AppText variant="subhead" tone="secondary">
                {t('overview:devices.wifi', { count: online.filter((c) => c.connection === 'wifi').length })}
              </AppText>
              <AppText variant="subhead" tone="secondary">
                {t('overview:devices.wired', { count: online.filter((c) => c.connection !== 'wifi').length })}
              </AppText>
              <AppText variant="footnote" tone="tertiary">
                {t('overview:devices.total', { count: clients.length })}
              </AppText>
            </View>
          </View>
        ) : (
          <CardSkeleton lines={2} />
        )}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: spacing.s },
  rings: { flexDirection: 'row', justifyContent: 'space-around' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legend: { flexDirection: 'row', gap: spacing.xl },
  legendItem: { gap: 2 },
  legendLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  devices: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  devicesDetail: { gap: 2 },
});
