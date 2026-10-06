import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import { deviceHref } from '@/features/devices/DeviceRow';
import { deviceIcon } from '@/features/devices/deviceIcon';
import { GroupBanner } from '@/features/devices/GroupBanner';
import { useDeviceActions } from '@/features/devices/useDeviceActions';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { hostOf } from '@/features/routers/login';
import {
  defaultScope,
  initialSelection,
  intruderRows,
  intruderSummary,
  needsTrustSetup,
  networkFor,
  networkHref,
  phoneSsid,
  type IntruderRow,
  type Scope,
} from '@/features/wifi-tools/intruders';
import { ScanAnimation } from '@/features/wifi-tools/ScanAnimation';
import { useGroupRouters, usePhoneIp } from '@/features/wifi-tools/useGroupWifi';
import { useTrust } from '@/features/wifi-tools/useTrust';
import { bandLabel } from '@/features/wireless/labels';
import { useGroupClients, useGroupRadios } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { HeaderButton, Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Badge, type BadgeTone } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDuration } from '@/utils/format';

/** The scan animation runs at least this long (design: results in 2–3 seconds). */
const SCAN_MS = 2_500;

/** "Who is on my Wi-Fi" (design §17.3, WF-3): strangers among the group's online devices, and what to do. */
export default function Intruders() {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const { router, connection } = useActiveRouter();
  const group = useGroupClients();
  const trust = useTrust();
  const phoneIp = usePhoneIp();
  const routers = useGroupRouters();
  const profiles = useRouters((s) => s.routers);
  const actions = useDeviceActions();

  const [round, setRound] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [fetchedRound, setFetchedRound] = useState(-1);
  const [scope, setScope] = useState<Scope | null>(null);
  const [selected, setSelected] = useState<IntruderRow | null>(null);
  const [kicking, setKicking] = useState<Client | null>(null);
  const [ban, setBan] = useState(false);
  const [blocking, setBlocking] = useState<Client | null>(null);
  const [picking, setPicking] = useState<Set<string> | null>(null);

  // Each scan reads the gateway's device list and every AP's stations afresh.
  const refetch = group.refetch;
  useEffect(() => {
    let alive = true;
    if (connection) {
      void refetch({ cancelRefetch: false }).finally(() => alive && setFetchedRound(round));
    }
    const timer = setTimeout(() => alive && setScanning(false), SCAN_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [round, refetch, connection]);
  const busy = scanning || (fetchedRound < round && group.isFetching) || (!group.data && !group.isError);
  const rescan = () => {
    setScanning(true);
    setRound((r) => r + 1);
  };

  const clients = group.data?.clients ?? [];
  const ssid = phoneSsid(clients, phoneIp);
  const wanted = scope ?? defaultScope(ssid);
  const effective: Scope = wanted === 'ssid' && !ssid ? 'wifi' : wanted;
  const scopes: Scope[] = ssid ? ['ssid', 'wifi', 'all'] : ['wifi', 'all'];
  const ids = new Set(routers.map((r) => r.id));
  const routerIps = new Map(profiles.filter((p) => ids.has(p.id)).map((p) => [hostOf(p.baseUrl), p.name] as const));
  const rows = intruderRows(clients, effective, { ssid, trusted: trust.trusted, phoneIp, routers: routerIps });
  const summary = intruderSummary(rows);
  const setup = trust.ready && needsTrustSetup(trust.trusted, rows);

  const radios = useGroupRadios();
  const routerOf = (c: Client) => c.ap?.routerId ?? router?.id;

  /** Resolves to whether the trust list was written; failures show as a toast. */
  const writeTrust = (macs: string[], value: boolean): Promise<boolean> =>
    trust.setTrusted(macs, value).then(
      () => true,
      (error: unknown) => {
        toast(describeError(t, error).title, 'error');
        return false;
      },
    );
  const setTrusted = (macs: string[], value: boolean) =>
    writeTrust(macs, value).then((ok) => {
      if (ok)
        toast(value ? t('wifitools:intruders.trusted', { count: macs.length }) : t('wifitools:intruders.untrusted'));
    });
  /** The ticked devices of the list become trusted, the unticked ones not. */
  const applyPicks = async (picked: ReadonlySet<string>) => {
    const macs = rows.map((r) => r.client.mac);
    const add = macs.filter((m) => picked.has(m) && !trust.trusted.has(m));
    const remove = macs.filter((m) => !picked.has(m) && trust.trusted.has(m));
    let ok = true;
    if (add.length) ok = await writeTrust(add, true);
    if (ok && remove.length) ok = await writeTrust(remove, false);
    if (!ok) return;
    toast(t('wifitools:intruders.pick.saved'));
    setPicking(null);
  };

  const sheetActions = (row: IntruderRow): SheetAction[] => {
    const c = row.client;
    const list: SheetAction[] = [];
    list.push(
      row.trusted
        ? { label: t('wifitools:intruders.untrust'), icon: 'shield', onPress: () => void setTrusted([c.mac], false) }
        : { label: t('wifitools:intruders.trust'), icon: 'shield', onPress: () => void setTrusted([c.mac], true) },
    );
    // Never offer to cut the phone itself off.
    if (!row.phone && c.wifi && !c.ap?.stale) {
      list.push({ label: t('devices:actions.kick'), icon: 'kick', onPress: () => setKicking(c) });
    }
    if (!row.phone && !c.isBlocked) {
      list.push({
        label: t('devices:actions.block'),
        icon: 'block',
        destructive: true,
        disabled: actions.busy,
        onPress: () => setBlocking(c),
      });
    }
    if (c.connection === 'wifi') {
      const owner = routerOf(c);
      const network = networkFor(radios.find((r) => r.routerId === owner)?.radios, c);
      list.push({
        label: t('wifitools:intruders.changePassword'),
        icon: 'key',
        disabled: !network,
        onPress: () =>
          network &&
          nav.push(networkHref(network.section, owner !== router?.id ? owner : undefined), { withAnchor: true }),
      });
    }
    list.push({ label: t('wifitools:intruders.details'), icon: 'info', onPress: () => nav.push(deviceHref(c.mac)) });
    return list.map((a) => ({
      ...a,
      onPress: () => {
        setSelected(null);
        a.onPress();
      },
    }));
  };

  return (
    <Screen
      title={t('wifitools:intruders.title')}
      headerRight={
        <HeaderButton
          icon="refresh"
          onPress={rescan}
          accessibilityLabel={t('wifitools:intruders.rescan')}
          testID="intruders-rescan"
        />
      }
      onRefresh={rescan}
      top={
        <>
          <ConnectionBanner error={group.data ? group.error : null} onRetry={rescan} />
          <GroupBanner />
        </>
      }>
      {busy ? (
        <ScanAnimation
          title={t('wifitools:intruders.scanning')}
          detail={t('wifitools:intruders.scanningDetail', {
            names: routers.map((r) => r.name).join(t('wifitools:separator')),
          })}
        />
      ) : !group.data ? (
        <ErrorState error={group.error} onRetry={rescan} />
      ) : (
        <>
          <Summary
            scope={effective}
            ssid={ssid}
            online={summary.online}
            strangers={summary.strangers}
            trustReady={trust.ready}
          />
          <Segmented
            values={scopes.map((s) => t(`wifitools:intruders.scope.${s}`, { ssid }))}
            selectedIndex={scopes.indexOf(effective)}
            onChange={(e) => setScope(scopes[e.nativeEvent.selectedSegmentIndex])}
          />

          {setup && !picking ? (
            <GlassCard title={t('wifitools:intruders.setup.title')} icon="shield" contentStyle={styles.card}>
              <AppText variant="subhead" tone="secondary">
                {t('wifitools:intruders.setup.message')}
              </AppText>
              <GlassButton
                label={t('wifitools:intruders.setup.start')}
                variant="primary"
                onPress={() => setPicking(initialSelection(rows))}
                testID="intruders-setup"
              />
            </GlassCard>
          ) : null}

          {picking ? (
            <GlassCard contentStyle={styles.card}>
              <AppText variant="subhead">{t('wifitools:intruders.pick.hint', { count: picking.size })}</AppText>
              <View style={styles.buttons}>
                <GlassButton label={t('cancel')} onPress={() => setPicking(null)} style={styles.button} compact />
                <GlassButton
                  label={t('wifitools:intruders.pick.all')}
                  onPress={() => setPicking(new Set(rows.map((r) => r.client.mac)))}
                  style={styles.button}
                  compact
                />
                <GlassButton
                  label={t('wifitools:intruders.pick.confirm')}
                  variant="primary"
                  loading={trust.busy}
                  onPress={() => void applyPicks(picking)}
                  style={styles.button}
                  compact
                  testID="intruders-trust-picked"
                />
              </View>
            </GlassCard>
          ) : null}

          {rows.length ? (
            <ListSection footer={trust.source === 'local' ? t('wifitools:intruders.localTrust') : undefined}>
              {rows.map((row) => (
                <IntruderListRow
                  key={row.client.mac}
                  row={row}
                  picked={picking ? picking.has(row.client.mac) : undefined}
                  onPress={() => {
                    if (!picking) {
                      setSelected(row);
                      return;
                    }
                    const next = new Set(picking);
                    if (next.has(row.client.mac)) next.delete(row.client.mac);
                    else next.add(row.client.mac);
                    setPicking(next);
                  }}
                />
              ))}
            </ListSection>
          ) : (
            <EmptyState icon="devices" title={t('wifitools:intruders.empty')} />
          )}

          {!picking && !setup && rows.length ? (
            <ListSection>
              <ListRow
                icon="check"
                title={t('wifitools:intruders.pick.start')}
                onPress={() => setPicking(new Set(rows.filter((r) => r.trusted || r.phone).map((r) => r.client.mac)))}
                testID="intruders-pick"
              />
            </ListSection>
          ) : null}

          <View style={styles.notes}>
            <AppText variant="footnote" tone="tertiary">
              {t('wifitools:intruders.note.kick')}
            </AppText>
            <AppText variant="footnote" tone="tertiary">
              {t('wifitools:intruders.note.private')}
            </AppText>
          </View>
        </>
      )}

      <ActionSheet
        visible={!!selected}
        title={selected?.client.name}
        message={selected ? [selected.client.ipv4, selected.client.mac].filter(Boolean).join(' · ') : undefined}
        actions={selected ? sheetActions(selected) : []}
        onCancel={() => setSelected(null)}
      />
      {/* Sent to the AP the device is associated with (NG-5, useDeviceActions). */}
      <RiskConfirm
        visible={!!kicking}
        level="medium"
        disruptive
        title={t('devices:confirm.kickTitle', { name: kicking?.name ?? '' })}
        consequences={[
          t('devices:confirm.kickConsequence'),
          ...(ban ? [t('devices:confirm.kickBanConsequence')] : []),
          t('wifitools:intruders.kickTemporary'),
        ]}
        confirmLabel={t('devices:actions.kick')}
        option={{ label: t('devices:actions.kickBan'), value: ban, onChange: setBan }}
        onCancel={() => setKicking(null)}
        onConfirm={() => {
          const c = kicking;
          setKicking(null);
          if (c) actions.kick(c, ban);
        }}
      />
      <RiskConfirm
        visible={!!blocking}
        level="medium"
        disruptive
        title={t('devices:confirm.blockTitle', { name: blocking?.name ?? '' })}
        consequences={[t('devices:confirm.blockConsequence'), t('devices:confirm.applyConsequence')]}
        confirmLabel={t('devices:actions.block')}
        onCancel={() => setBlocking(null)}
        onConfirm={() => {
          const c = blocking;
          setBlocking(null);
          if (c) actions.block(c);
        }}
      />
    </Screen>
  );
}

function Summary({
  scope,
  ssid,
  online,
  strangers,
  trustReady,
}: {
  scope: Scope;
  ssid?: string;
  online: number;
  strangers: number;
  trustReady: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const head = t(`wifitools:intruders.summary.${scope}`, { ssid, online });
  const tail = strangers
    ? t('wifitools:intruders.summary.strangers', { count: strangers })
    : t('wifitools:intruders.summary.clean');
  return (
    <GlassCard contentStyle={styles.summary} testID="intruders-summary">
      <Icon name="shield" size={30} color={strangers ? colors.warning : colors.success} />
      <View style={styles.summaryText}>
        <AppText variant="headline">{`${head}${tail}`}</AppText>
        {!trustReady ? (
          <AppText variant="footnote" tone="secondary">
            {t('wifitools:intruders.readingTrust')}
          </AppText>
        ) : null}
      </View>
    </GlassCard>
  );
}

function IntruderListRow({ row, picked, onPress }: { row: IntruderRow; picked?: boolean; onPress(): void }) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const c = row.client;
  const vendor = c.vendor ?? (c.randomizedMac ? t('devices:privateAddress') : undefined);
  const where =
    c.connection === 'wifi'
      ? [
          c.ap?.name ?? c.wifi?.ssid,
          c.wifi?.band || c.ap?.band ? bandLabel(t, c.wifi?.band ?? c.ap?.band) : null,
          c.wifi ? `${c.wifi.signal} dBm` : t('wifitools:intruders.signalUnknown'),
          c.wifi?.connectedSec
            ? t('wifitools:intruders.connectedFor', { duration: formatDuration(c.wifi.connectedSec, lang) })
            : null,
        ]
      : [t('devices:detail.wired')];
  const tags: { label: string; tone: BadgeTone }[] = [
    ...(row.stranger ? [{ label: t('wifitools:tag.stranger'), tone: 'danger' as const }] : []),
    ...(row.trusted ? [{ label: t('wifitools:tag.trusted'), tone: 'success' as const }] : []),
    ...(row.phone ? [{ label: t('wifitools:tag.phone'), tone: 'accent' as const }] : []),
    ...(row.router ? [{ label: t('wifitools:tag.router'), tone: 'neutral' as const }] : []),
    ...(row.random ? [{ label: t('wifitools:tag.random'), tone: 'neutral' as const }] : []),
    ...(c.isBlocked ? [{ label: t('devices:badge.blocked'), tone: 'danger' as const }] : []),
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={picked !== undefined ? { checked: picked } : undefined}
      onPress={onPress}
      testID={`intruder-${c.mac}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.fill : 'transparent' }]}>
      {picked !== undefined ? (
        <View
          style={[
            styles.check,
            {
              borderColor: picked ? colors.accent : colors.textTertiary,
              backgroundColor: picked ? colors.accent : 'transparent',
            },
          ]}>
          {picked ? <Icon name="check" size={14} color={colors.accentText} /> : null}
        </View>
      ) : (
        <View style={[styles.icon, { backgroundColor: row.stranger ? colors.danger : colors.accent }]}>
          <Icon name={deviceIcon(c)} size={18} color={colors.accentText} />
        </View>
      )}
      <View style={styles.texts}>
        <AppText variant="body" numberOfLines={1}>
          {c.name}
        </AppText>
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Badge key={tag.label} label={tag.label} tone={tag.tone} />
          ))}
        </View>
        <AppText variant="footnote" tone="secondary" numberOfLines={1} selectable>
          {[c.ipv4, c.mac, vendor].filter(Boolean).join(' · ')}
        </AppText>
        <AppText variant="footnote" tone="secondary" numberOfLines={1}>
          {where.filter(Boolean).join(' · ')}
        </AppText>
      </View>
      {picked === undefined ? <Icon name="chevronRight" size={16} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  buttons: { flexDirection: 'row', gap: spacing.s },
  button: { flex: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  summaryText: { flex: 1, gap: 2 },
  notes: { gap: spacing.s, marginHorizontal: spacing.l },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 3 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
