import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import { AGENT_PAGE } from '@/features/agent/AgentGate';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import { DEFAULT_RANGE, resolveRange, type TimeRange } from '@/features/traffic/timeRange';
import { GradeBadge, mbps } from '@/features/wifi-tools/GradeBadge';
import { filterHours, historyRetries, signalStats } from '@/features/wifi-tools/live';
import { findPhone } from '@/features/wifi-tools/monitor';
import { gradeSignal, isRateLow, retryRate, signalTips, snrOf, type SignalTip } from '@/features/wifi-tools/signal';
import { SignalChart } from '@/features/wifi-tools/SignalChart';
import {
  useGroupWifiPlugins,
  useLiveStation,
  usePhoneIp,
  useRoaming,
  useSignalHistory,
  type WifiPluginRouter,
} from '@/features/wifi-tools/useGroupWifi';
import { bandLabel } from '@/features/wireless/labels';
import { useGroupClients } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { InfoGrid } from '@/ui/InfoGrid';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Badge, StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatDayTime } from '@/utils/dates';
import { formatDuration } from '@/utils/format';
import { normalizeMac } from '@/utils/mac';

const TIP_ICON: Record<SignalTip, 'router' | 'antenna' | 'speed'> = {
  'move-closer': 'router',
  'add-ap': 'antenna',
  'rate-low': 'speed',
};
const ROAM_ROWS = 50;

/**
 * One client's signal (design §17.1, WF-1): live for the last five minutes on the AP it is on, then with
 * the plugin its history, roaming record and retry rate. Params: `mac`, optional `router` (that AP's id).
 */
export default function SignalDetail() {
  const t = useT();
  const params = useLocalSearchParams<{ mac: string; router?: string }>();
  const mac = normalizeMac(decodeURIComponent(params.mac ?? '')) ?? '';
  const { router } = useActiveRouter();
  const group = useGroupClients();
  const routers = useGroupWifiPlugins();
  const client = group.data?.clients.find((c) => c.mac === mac);
  // Where it is now (it may have roamed since the link was made), else the AP the link names.
  const apId = (client?.ap && !client.ap.stale ? client.ap.routerId : undefined) ?? params.router ?? router?.id;
  const ap = routers.find((r) => r.id === apId) ?? routers[0];

  return (
    <Screen title={client?.name ?? mac} onRefresh={() => group.refetch()}>
      {mac && ap ? (
        <Content key={`${ap.id}:${mac}`} mac={mac} client={client} ap={ap} routers={routers} />
      ) : (
        <EmptyState icon="wifi" title={group.isLoading ? t('loading') : t('wifitools:detail.notFound')} />
      )}
    </Screen>
  );
}

function Content({
  mac,
  client,
  ap,
  routers,
}: {
  mac: string;
  client?: Client;
  ap: WifiPluginRouter;
  routers: WifiPluginRouter[];
}) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const { colors } = useTheme();
  const phoneIp = usePhoneIp();
  const group = useGroupClients();
  const isPhone = !!client && findPhone(group.data?.clients ?? [], phoneIp)?.mac === client.mac;
  const live = useLiveStation(ap.id, mac, ap.wifi, !ap.loading && !!ap.connection);
  const station = live.data?.station ?? null;
  const pluginRouters = routers.filter((r) => r.wifi);
  const pluginsLoading = routers.some((r) => r.loading);

  // Not listed by the AP right now: the device list's (older) values would mislead.
  const absent = !!live.data && !station;
  // Current values: the AP's live answer, else what the device list knows.
  const wifi = absent ? undefined : client?.wifi;
  const signal = station?.signal ?? wifi?.signal;
  const noise = station?.noise ?? wifi?.noise;
  const band = station?.band ?? wifi?.band;
  const rates = { rx: station?.rxRate ?? wifi?.rxRate, tx: station?.txRate ?? wifi?.txRate };
  const grade = signal !== undefined ? gradeSignal(signal, noise) : undefined;
  const snr = signal !== undefined ? snrOf(signal, noise) : undefined;
  const tips = grade && band ? signalTips(grade, isRateLow(band, rates, station?.width)) : [];
  const retries = station ? retryRate(station.txRetries, station.txPackets) : undefined;

  // The chart only shows once there is a sample, which carries the time.
  const now = live.data?.now ?? 0;
  const livePoints = live.samples.map((s) => ({ t: s.t, signal: s.signal, rate: s.txRate }));

  return (
    <>
      <GlassCard contentStyle={styles.card}>
        <View style={styles.headline}>
          <AppText variant="title">{signal !== undefined ? `${signal} dBm` : '—'}</AppText>
          {grade ? <GradeBadge grade={grade} /> : null}
          {isPhone ? <Badge label={t('wifitools:tag.phone')} tone="accent" /> : null}
        </View>
        <AppText variant="subhead" tone="secondary">
          {absent
            ? t('wifitools:detail.notOnAp', { ap: ap.name })
            : [ap.name, band ? bandLabel(t, band) : null, station?.ssid || wifi?.ssid].filter(Boolean).join(' · ')}
        </AppText>
        <InfoGrid
          items={[
            { label: t('wifitools:detail.snr'), value: snr !== undefined ? `${snr} dB` : undefined },
            { label: t('wifitools:detail.noise'), value: noise !== undefined ? `${noise} dBm` : undefined },
            { label: t('wifitools:detail.down'), value: rates.tx ? `${mbps(rates.tx)} Mbps` : undefined },
            { label: t('wifitools:detail.up'), value: rates.rx ? `${mbps(rates.rx)} Mbps` : undefined },
            {
              label: t('wifitools:detail.connected'),
              value:
                (station?.connectedSec ?? wifi?.connectedSec)
                  ? formatDuration((station?.connectedSec ?? wifi?.connectedSec)!, lang)
                  : undefined,
            },
            {
              label: t('wifitools:detail.link'),
              value: station?.width
                ? [`${station.width} MHz`, station.mode ? t(`wifitools:mode.${station.mode}`) : null]
                    .filter(Boolean)
                    .join(' · ')
                : undefined,
            },
            {
              label: t('wifitools:detail.retries'),
              value: retries !== undefined ? `${retries.toFixed(1)}%` : undefined,
            },
          ]}
        />
        {isPhone ? (
          <AppText variant="footnote" tone="tertiary">
            {t('wifitools:detail.phoneNote')}
          </AppText>
        ) : null}
      </GlassCard>

      <GlassCard
        title={t('wifitools:detail.live')}
        subtitle={live.data?.source === 'iwinfo' ? t('wifitools:detail.every2s') : t('wifitools:detail.everySecond')}
        icon="pulse"
        contentStyle={styles.card}>
        {live.data ? (
          <SignalChart
            points={livePoints}
            start={now - 300}
            end={now}
            step={live.data.source === 'plugin' ? 10 : 4}
            live
            testID="signal-live"
          />
        ) : (
          <Skeleton height={168} radius={12} />
        )}
      </GlassCard>

      <GlassCard title={t('wifitools:detail.tips')} icon="info" contentStyle={styles.tips}>
        {tips.length ? (
          tips.map((tip) => (
            <View key={tip} style={styles.tip}>
              <Icon name={TIP_ICON[tip]} size={18} color={colors.warning} />
              <AppText variant="subhead" style={styles.tipText}>
                {t(`wifitools:tip.${tip}`)}
              </AppText>
            </View>
          ))
        ) : (
          <View style={styles.tip}>
            <Icon name="check" size={18} color={colors.success} />
            <AppText variant="subhead" style={styles.tipText}>
              {grade ? t('wifitools:tip.none') : t('wifitools:tip.unknown')}
            </AppText>
          </View>
        )}
      </GlassCard>

      {pluginRouters.length ? (
        <History mac={mac} routers={pluginRouters} />
      ) : pluginsLoading ? null : (
        <Banner
          tone="info"
          text={t('wifitools:detail.needsPlugin')}
          action={{
            label: t('wifitools:detail.installPlugin'),
            onPress: () => nav.push(AGENT_PAGE, { withAnchor: true }),
          }}
        />
      )}
    </>
  );
}

/** History, retries and the roaming record over the picked time range (plugin only). */
function History({ mac, routers }: { mac: string; routers: WifiPluginRouter[] }) {
  const t = useT();
  const lang = useLang();
  const [range, setRange] = useState<TimeRange>(DEFAULT_RANGE);
  const [now, setNow] = useState(() => new Date());
  const { start, end } = resolveRange(range, now);
  const { history, isLoading } = useSignalHistory(routers, mac, start, end);
  const roaming = useRoaming(routers, mac, start, end);
  const points = history ? filterHours(history.points, range.hours) : [];
  const stats = signalStats(points);
  const sent = historyRetries(points);

  return (
    <>
      <AppText variant="headline" style={styles.sectionTitle}>
        {t('wifitools:detail.history')}
      </AppText>
      <TimeRangePicker
        value={range}
        onChange={(r) => {
          setNow(new Date());
          setRange(r);
        }}
      />
      <GlassCard contentStyle={styles.card}>
        {history ? (
          <SignalChart
            points={points.map((p) => ({ t: p.t, signal: p.signal, rate: p.txRate }))}
            start={start}
            end={end}
            step={Math.max(1, history.step)}
            testID="signal-history"
          />
        ) : isLoading ? (
          <Skeleton height={168} radius={12} />
        ) : (
          <AppText variant="footnote" tone="tertiary">
            {t('wifitools:chart.empty')}
          </AppText>
        )}
        <InfoGrid
          items={[
            { label: t('wifitools:detail.average'), value: stats ? `${stats.avg} dBm` : undefined },
            { label: t('wifitools:detail.weakest'), value: stats ? `${stats.min} dBm` : undefined },
            {
              label: t('wifitools:detail.retried'),
              value: sent
                ? t('wifitools:detail.retriedValue', { retries: sent.retries, failed: sent.failed })
                : undefined,
              wide: true,
            },
          ]}
        />
      </GlassCard>

      <ListSection title={t('wifitools:detail.roaming')} footer={t('wifitools:detail.roamingNote')}>
        {roaming.entries.length ? (
          roaming.entries.slice(0, ROAM_ROWS).map((e) => (
            <ListRow
              key={`${e.ts}-${e.routerId}-${e.kind}`}
              title={t(e.kind === 'connect' ? 'wifitools:roam.connect' : 'wifitools:roam.disconnect', {
                ap: e.apName,
              })}
              subtitle={e.band ? bandLabel(t, e.band) : undefined}
              value={formatDayTime(e.ts, lang)}
              left={<StatusDot status={e.kind === 'connect' ? 'online' : 'offline'} />}
              right={e.roamed ? <Badge label={t('wifitools:roam.roamed')} tone="accent" /> : undefined}
            />
          ))
        ) : (
          <ListRow title={roaming.isLoading ? t('loading') : t('wifitools:roam.none')} />
        )}
      </ListSection>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, flexWrap: 'wrap' },
  tips: { gap: spacing.s },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s },
  tipText: { flex: 1 },
  sectionTitle: { marginLeft: spacing.l, marginTop: spacing.s },
});
