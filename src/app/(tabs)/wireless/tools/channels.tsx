import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Band } from '@/api/services/clients';
import { isPhoneOnNetwork, radioChanges } from '@/api/services/wireless';
import { GroupBanner } from '@/features/devices/GroupBanner';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { channelTable, spanOf, type ChannelAdvice } from '@/features/wifi-tools/channel';
import { ChannelChart } from '@/features/wifi-tools/ChannelChart';
import {
  adviseGroup,
  bandRange,
  chartNetworks,
  htmodeAt20,
  scanRouter,
  type RadioScan,
} from '@/features/wifi-tools/channelScan';
import { useGroupRouters, usePhoneIp } from '@/features/wifi-tools/useGroupWifi';
import { bandLabel } from '@/features/wireless/labels';
import { useGroupApply } from '@/features/wireless/useGroupApply';
import { useClients } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner, EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Badge } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const BANDS: Band[] = ['2.4G', '5G', '6G'];
/** Channels labelled on the 2.4 GHz axis; 5/6 GHz label every channel of the radio. */
const AXIS_24 = [1, 6, 11];

interface ScanResult {
  radios: RadioScan[];
  /** Routers not scanned: no connection (password unknown) or the scan failed. */
  missing: { name: string; error?: unknown }[];
}

/** A switch waiting for confirmation: a new channel, or 20 MHz on a crowded 2.4 GHz radio. */
interface Pending {
  radio: RadioScan;
  kind: 'channel' | 'width';
  channel?: number;
  htmode?: string;
  dfs: boolean;
  /** The phone is on this radio: a DFS wait could outlast the rollback timer. */
  direct: boolean;
}

/** Channel scan and optimisation (design §17.2, WF-2) for every radio of the network group. */
export default function Channels() {
  const t = useT();
  const toast = useToast();
  const { group } = useActiveRouter();
  const routers = useGroupRouters();
  const clients = useClients();
  const phoneIp = usePhoneIp();
  const apply = useGroupApply();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [allowDfs, setAllowDfs] = useState(false);
  const [band, setBand] = useState<Band | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const start = async () => {
    setScanning(true);
    const settled = await Promise.allSettled(
      routers.map((r) =>
        r.connection
          ? scanRouter(r.connection, { id: r.id, name: r.name })
          : Promise.reject(new Error('no-connection')),
      ),
    );
    setResult({
      radios: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value.radios : [])),
      missing: settled.flatMap((s, i) =>
        s.status === 'rejected' ? [{ name: routers[i].name, error: routers[i].connection ? s.reason : undefined }] : [],
      ),
    });
    setScanning(false);
  };

  const radios = result?.radios ?? [];
  const advice = adviseGroup(radios, allowDfs);
  const ownBssids = new Set(radios.flatMap((r) => r.bssids));
  const bands = BANDS.filter((b) => radios.some((r) => r.band === b));
  const shownBand = band && bands.includes(band) ? band : bands[0];
  const changes = [...advice.values()].filter((a) => a.recommended || a.suggestWidth20).length;

  const phoneOn = (r: RadioScan) =>
    r.radio.networks.some((n) =>
      isPhoneOnNetwork(phoneIp, clients.data ?? [], n.ifname, group.gateway ? r.routerId : undefined),
    );
  const ask = (r: RadioScan, a: ChannelAdvice, kind: Pending['kind']) => {
    const dfs = kind === 'channel' && a.dfs;
    setPending({
      radio: r,
      kind,
      channel: kind === 'channel' ? a.recommended : undefined,
      htmode: kind === 'width' ? htmodeAt20(r.htmode) : undefined,
      dfs,
      direct: dfs && phoneOn(r),
    });
  };

  const run = async (p: Pending) => {
    const patch = p.kind === 'channel' ? { channel: String(p.channel) } : { htmode: p.htmode };
    const [step] = await apply.run([
      {
        routerId: p.radio.routerId,
        changes: radioChanges(p.radio.radio, patch),
        mode: p.direct ? 'direct' : 'rollback',
        sections: [],
      },
    ]);
    if (step.status === 'skipped') {
      toast(t('wifitools:channels.unreachable', { name: p.radio.routerName }), 'error');
    } else if (step.status === 'failed') {
      toast(describeError(t, step.error).title, 'error');
    } else if (step.outcome.status === 'rolled-back') {
      toast(t('wireless:result.rolledBack'), 'warning');
    } else {
      toast(t('wireless:result.applied'));
      // The radio is on its new setting now; what the others heard stays as scanned.
      setResult((res) =>
        res
          ? {
              ...res,
              radios: res.radios.map((r) =>
                r.key !== p.radio.key
                  ? r
                  : p.kind === 'channel'
                    ? { ...r, channel: p.channel!, radio: { ...r.radio, channel: String(p.channel) } }
                    : { ...r, width: 20, htmode: p.htmode, radio: { ...r.radio, htmode: p.htmode } },
              ),
            }
          : res,
      );
    }
  };

  return (
    <Screen title={t('wifitools:channels.title')} top={<GroupBanner />}>
      <GlassCard icon="scan" title={t('wifitools:channels.introTitle')} contentStyle={styles.card}>
        <AppText variant="subhead" tone="secondary">
          {t('wifitools:channels.intro')}
        </AppText>
        <AppText variant="footnote" tone="warning">
          {t('wifitools:channels.scanWarning')}
        </AppText>
        <GlassButton
          label={
            scanning
              ? t('wifitools:channels.scanning', { count: routers.length })
              : result
                ? t('wifitools:channels.rescan')
                : t('wifitools:channels.start')
          }
          icon="scan"
          variant="primary"
          loading={scanning}
          disabled={scanning || apply.busy}
          onPress={() => void start()}
          testID="channels-scan"
        />
      </GlassCard>

      {result ? (
        <>
          {result.missing.map((m) => (
            <Banner
              key={m.name}
              tone="warning"
              text={
                m.error
                  ? t('wifitools:channels.failed', { name: m.name, error: describeError(t, m.error).title })
                  : t('wifitools:channels.unreachable', { name: m.name })
              }
            />
          ))}
          {radios.length ? (
            <>
              <AppText variant="headline" style={styles.summary} testID="channels-summary">
                {changes
                  ? t('wifitools:channels.summaryChange', { count: changes })
                  : t('wifitools:channels.summaryKeep')}
              </AppText>
              <ListSection footer={t('wifitools:channels.dfsHint')}>
                <ListRow
                  title={t('wifitools:channels.allowDfs')}
                  icon="antenna"
                  switchValue={allowDfs}
                  onSwitch={setAllowDfs}
                  testID="channels-dfs"
                />
              </ListSection>
              {bands.length > 1 ? (
                <Segmented
                  values={bands.map((b) => bandLabel(t, b))}
                  selectedIndex={bands.indexOf(shownBand)}
                  onChange={(e) => setBand(bands[e.nativeEvent.selectedSegmentIndex])}
                />
              ) : null}
              <Legend />
              {radios
                .filter((r) => r.band === shownBand)
                .map((r) => (
                  <RadioCard
                    key={r.key}
                    scan={r}
                    advice={advice.get(r.key)}
                    ownBssids={ownBssids}
                    busy={apply.busy}
                    onSwitch={(a, kind) => ask(r, a, kind)}
                  />
                ))}
            </>
          ) : (
            <EmptyState icon="wifiOff" title={t('wifitools:channels.none')} />
          )}
        </>
      ) : null}

      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending
            ? pending.kind === 'channel'
              ? t('wifitools:channels.confirm.channel', {
                  router: pending.radio.routerName,
                  band: bandLabel(t, pending.radio.band),
                  channel: pending.channel,
                })
              : t('wifitools:channels.confirm.width', {
                  router: pending.radio.routerName,
                  band: bandLabel(t, pending.radio.band),
                })
            : ''
        }
        consequences={
          pending
            ? [
                t('wifitools:channels.confirm.drop'),
                ...(pending.dfs ? [t('wifitools:channels.confirm.dfs')] : []),
                pending.direct ? t('wifitools:channels.confirm.direct') : t('wifitools:channels.confirm.rollback'),
              ]
            : []
        }
        confirmLabel={t('common:confirm')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void run(p);
        }}
      />
    </Screen>
  );
}

function Legend() {
  const t = useT();
  const { colors } = useTheme();
  const item = (color: string, label: string, dashed?: boolean) => (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.swatch,
          dashed
            ? { borderColor: color, borderStyle: 'dashed', borderWidth: 1.5 }
            : { backgroundColor: color, opacity: 0.6 },
        ]}
      />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
  return (
    <View style={styles.legend}>
      {item(colors.accent, t('wifitools:channels.legend.own'))}
      {item(colors.textTertiary, t('wifitools:channels.legend.other'))}
      {item(colors.accent, t('wifitools:channels.legend.current'), true)}
      {item(colors.success, t('wifitools:channels.legend.target'), true)}
    </View>
  );
}

function RadioCard({
  scan,
  advice,
  ownBssids,
  busy,
  onSwitch,
}: {
  scan: RadioScan;
  advice?: ChannelAdvice;
  ownBssids: ReadonlySet<string>;
  busy: boolean;
  onSwitch(a: ChannelAdvice, kind: Pending['kind']): void;
}) {
  const t = useT();
  const [table, setTable] = useState(false);
  const channels = scan.freqs.map((f) => f.channel);
  const range = bandRange(scan.band, channels);
  const self = scan.channel ? spanOf(scan.band, scan.channel, scan.width) : undefined;
  const target = advice?.recommended ? spanOf(scan.band, advice.recommended, scan.width) : undefined;
  const width20 = advice?.suggestWidth20 ? htmodeAt20(scan.htmode) : undefined;
  const currentBusy = scan.busy[scan.channel];

  const rows = channelTable(scan.band, scan.scan, [...ownBssids], channels).filter(
    (row) =>
      row.networks > 0 ||
      scan.busy[row.channel] !== undefined ||
      row.channel === scan.channel ||
      row.channel === advice?.recommended,
  );

  return (
    <>
      <GlassCard
        title={scan.routerName}
        subtitle={[
          bandLabel(t, scan.band),
          scan.channel ? t('wifitools:channels.channel', { channel: scan.channel }) : null,
          `${scan.width} MHz`,
          currentBusy !== undefined ? t('wifitools:channels.busy', { pct: currentBusy }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        icon="router"
        contentStyle={styles.card}
        testID={`channels-${scan.key}`}>
        {scan.scanFailed ? <Banner tone="warning" text={t('wifitools:channels.scanFailed')} /> : null}
        <ChannelChart
          band={scan.band}
          range={range}
          channels={scan.band === '2.4G' ? AXIS_24.filter((c) => channels.includes(c)) : channels}
          networks={chartNetworks(scan, ownBssids)}
          self={self}
          target={target}
        />
        {advice ? (
          <View style={styles.advice}>
            <AppText variant="subhead">
              {advice.reason === 'change'
                ? t('wifitools:channels.reason.change', {
                    to: advice.recommended,
                    pct: Math.round(advice.reduction * 100),
                  })
                : t(`wifitools:channels.reason.${advice.reason}`)}
            </AppText>
            {advice.dfs ? (
              <View style={styles.badges}>
                <Badge label={t('wifitools:channels.dfs')} tone="warning" />
              </View>
            ) : null}
            {advice.suggestWidth20 && advice.reason !== 'crowded-24' ? (
              <AppText variant="subhead">{t('wifitools:channels.reason.crowded-24')}</AppText>
            ) : null}
            {advice.recommended ? (
              <GlassButton
                label={t('wifitools:channels.switchTo', { channel: advice.recommended })}
                variant="primary"
                disabled={busy}
                loading={busy}
                onPress={() => onSwitch(advice, 'channel')}
                testID={`channels-switch-${scan.key}`}
              />
            ) : null}
            {width20 ? (
              <GlassButton
                label={t('wifitools:channels.toWidth20')}
                disabled={busy}
                onPress={() => onSwitch(advice, 'width')}
                testID={`channels-width-${scan.key}`}
              />
            ) : null}
          </View>
        ) : (
          <AppText variant="subhead" tone="secondary">
            {t('wifitools:channels.noChannel')}
          </AppText>
        )}
      </GlassCard>
      <ListSection>
        <ListRow
          title={t('wifitools:channels.table')}
          value={t('wifitools:channels.heard', { count: scan.scan.length })}
          icon="chart"
          chevron
          onPress={() => setTable((v) => !v)}
        />
        {table
          ? rows.map((row) => (
              <ListRow
                key={row.channel}
                title={t('wifitools:channels.channel', { channel: row.channel })}
                subtitle={
                  row.networks
                    ? [
                        t('wifitools:channels.networks', { count: row.networks }),
                        row.strongest !== undefined
                          ? t('wifitools:channels.strongest', { signal: row.strongest })
                          : null,
                        row.own ? t('wifitools:channels.own', { count: row.own }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t('wifitools:channels.quiet')
                }
                value={
                  scan.busy[row.channel] !== undefined
                    ? t('wifitools:channels.busy', { pct: scan.busy[row.channel] })
                    : undefined
                }
                right={
                  row.channel === scan.channel ? (
                    <Badge label={t('wifitools:channels.legend.current')} tone="accent" />
                  ) : row.channel === advice?.recommended ? (
                    <Badge label={t('wifitools:channels.legend.target')} tone="success" />
                  ) : undefined
                }
              />
            ))
          : null}
      </ListSection>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  summary: { marginLeft: spacing.l },
  advice: { gap: spacing.s },
  badges: { flexDirection: 'row' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.m, marginHorizontal: spacing.l },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 14, height: 10, borderRadius: 3 },
});
