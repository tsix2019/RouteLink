import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isPhoneOnNetwork, validateNetwork } from '@/api/services/wireless';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import {
  fixNeedsKey,
  generatePassword,
  passwordStrength,
  worstLevel,
  type SecurityFinding,
  type SecurityFix,
  type SecurityLevel,
} from '@/features/wifi-tools/security';
import { checkGroup, planFix, type FixPlan, type NetworkCheck } from '@/features/wifi-tools/securityPlan';
import { useGroupRouters, usePhoneIp, useWifiFeatures } from '@/features/wifi-tools/useGroupWifi';
import { bandLabel, encryptionLabel } from '@/features/wireless/labels';
import { useReconnectDraft } from '@/features/wireless/reconnectDraft';
import { useGroupApply } from '@/features/wireless/useGroupApply';
import { useClients, useGroupRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EditSheet } from '@/ui/EditSheet';
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon, type IconName } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Badge, type BadgeTone } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const LEVEL_TONE: Record<SecurityLevel, BadgeTone> = {
  high: 'success',
  medium: 'accent',
  low: 'warning',
  danger: 'danger',
};
const FINDING_ICON: Record<SecurityFinding['kind'], IconName> = {
  password: 'key',
  wps: 'lockOpen',
  'mfp-off': 'shield',
  'guest-not-isolated': 'guest',
  hidden: 'eyeOff',
};

interface Pending {
  check: NetworkCheck;
  plan: FixPlan;
  key?: string;
}

const idOf = (c: Pick<NetworkCheck, 'routerId' | 'section'>) => `${c.routerId}/${c.section}`;

/** Wi-Fi security check (design §17.4, WF-4): every SSID of the group rated, with one-tap fixes. */
export default function Security() {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const { router: active, group } = useActiveRouter();
  const groupRadios = useGroupRadios();
  const routers = useGroupRouters();
  const features = useWifiFeatures(routers);
  const clients = useClients();
  const phoneIp = usePhoneIp();
  const groupApply = useGroupApply();
  const setReconnect = useReconnectDraft((s) => s.set);
  const [fixing, setFixing] = useState<NetworkCheck | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Networks whose password was renewed here: offer the share QR. */
  const [renewed, setRenewed] = useState<ReadonlySet<string>>(new Set());

  const phoneOn = (routerId: string, ifname?: string) =>
    isPhoneOnNetwork(phoneIp, clients.data ?? [], ifname, group.gateway ? routerId : undefined);
  const checks = checkGroup(groupRadios, features, phoneOn);
  const overall = worstLevel(checks.map((c) => c.level));
  // Without the routers' hostapd features the fixes would first leave out WPA3, then add it.
  const featuresReady = routers.every((r) => !r.connection || features[r.id]);
  const loading = !featuresReady || (!checks.length && groupRadios.some((g) => g.isLoading));
  const unreachable = groupRadios.filter((g) => g.needsPassword || (g.error && !g.radios));
  const routerName = (id: string) => groupRadios.find((g) => g.routerId === id)?.name ?? id;

  const apply = async ({ check, plan, key }: Pending) => {
    const results = await groupApply.run(plan.steps);
    const failed = results.filter((r) => r.status !== 'done' || r.outcome.status === 'rolled-back');
    if (failed.length) {
      toast(
        t('wireless:sync.partial', {
          count: failed.length,
          names: failed.map((r) => routerName(r.routerId)).join(t('wifitools:separator')),
        }),
        'warning',
      );
    } else {
      toast(
        plan.steps.length > 1 ? t('wireless:sync.done', { count: plan.steps.length }) : t('wifitools:security.applied'),
      );
    }
    if (plan.rejoin) {
      setReconnect(check.ssid, plan.newKey ? key : check.network.key);
      nav.push('/wireless/reconnect');
      return;
    }
    if (plan.newKey && !failed.some((r) => r.routerId === check.routerId)) {
      setRenewed((s) => new Set([...s, idOf(check)]));
    }
  };

  return (
    <Screen title={t('wifitools:security.title')} onRefresh={() => groupRadios.forEach((g) => g.refetch())}>
      {unreachable.map((g) => (
        <Banner key={g.routerId} tone="warning" text={t('wifitools:security.unreachable', { name: g.name })} />
      ))}
      {loading ? (
        <View style={styles.loading}>
          <Skeleton height={96} radius={22} />
          <Skeleton height={160} radius={22} />
        </View>
      ) : checks.length && overall ? (
        <>
          <Summary level={overall} count={checks.length} />
          {checks.map((c) => (
            <NetworkCard
              key={idOf(c)}
              check={c}
              grouped={!!group.gateway}
              renewed={renewed.has(idOf(c))}
              busy={groupApply.busy}
              onFix={() => setFixing(c)}
              onShare={() =>
                nav.push(
                  `/wifi-qr?section=${encodeURIComponent(c.section)}${
                    c.routerId !== active?.id ? `&router=${encodeURIComponent(c.routerId)}` : ''
                  }`,
                )
              }
            />
          ))}
        </>
      ) : (
        <EmptyState icon="wifiOff" title={t('wifitools:security.empty')} />
      )}

      {fixing ? (
        <FixSheet
          check={fixing}
          plan={(fixes, key, sync) => planFix(fixing, fixes, key, groupRadios, phoneOn, sync)}
          onCancel={() => setFixing(null)}
          onApply={(plan, key) => {
            setFixing(null);
            setPending({ check: fixing, plan, key });
          }}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending ? t('wifitools:security.confirmTitle', { ssid: pending.check.ssid }) : ''}
        consequences={
          pending
            ? [
                ...(pending.plan.steps.length > 1
                  ? [t('wireless:sync.consequence', { count: pending.plan.steps.length })]
                  : []),
                ...(pending.plan.phoneDrops
                  ? [
                      pending.plan.rejoin
                        ? t('wireless:network.consequencePhone')
                        : t('wifitools:security.consequencePhoneBrief'),
                      t('wireless:network.consequenceNoRollback'),
                    ]
                  : [t('wireless:network.consequenceRestart'), t('wireless:network.consequenceRollback')]),
              ]
            : []
        }
        confirmLabel={t('common:confirm')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void apply(p);
        }}
      />
    </Screen>
  );
}

function Summary({ level, count }: { level: SecurityLevel; count: number }) {
  const t = useT();
  const { colors } = useTheme();
  const color = { high: colors.success, medium: colors.accent, low: colors.warning, danger: colors.danger }[level];
  return (
    <GlassCard contentStyle={styles.summary} testID="security-summary">
      <Icon name="shield" size={34} color={color} />
      <View style={styles.flex}>
        <AppText variant="headline">
          {t('wifitools:security.overall', { level: t(`wifitools:security.level.${level}`) })}
        </AppText>
        <AppText variant="footnote" tone="secondary">
          {t('wifitools:security.checked', { count })}
        </AppText>
        <AppText variant="footnote" tone="tertiary">
          {t('wifitools:security.localOnly')}
        </AppText>
      </View>
    </GlassCard>
  );
}

function FindingText({ finding }: { finding: SecurityFinding }) {
  const t = useT();
  if (finding.kind !== 'password') return <>{t(`wifitools:security.finding.${finding.kind}`)}</>;
  const strength = t(`wifitools:security.strength.${finding.strength}`);
  const reasons = finding.reasons.map((r) => t(`wifitools:security.weak.${r}`)).join(t('wifitools:separator'));
  return (
    <>
      {reasons
        ? t('wifitools:security.finding.passwordWithReasons', { strength, reasons })
        : t('wifitools:security.finding.password', { strength })}
    </>
  );
}

function NetworkCard({
  check,
  grouped,
  renewed,
  busy,
  onFix,
  onShare,
}: {
  check: NetworkCheck;
  grouped: boolean;
  renewed: boolean;
  busy: boolean;
  onFix(): void;
  onShare(): void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const sae = check.features.sae;
  // checkNetwork only offers WPA3 when the router says it can; otherwise say why there is no fix.
  const noWpa3 = check.level !== 'high' && sae !== true && !check.fixes.includes('upgrade-wpa3');

  return (
    <GlassCard
      title={check.ssid || check.section}
      subtitle={[
        grouped ? check.routerName : null,
        bandLabel(t, check.band),
        encryptionLabel(t, check.network.encryption),
      ]
        .filter(Boolean)
        .join(' · ')}
      icon="wifi"
      accessory={<Badge label={t(`wifitools:security.level.${check.level}`)} tone={LEVEL_TONE[check.level]} />}
      contentStyle={styles.card}
      testID={`security-${check.routerId}-${check.section}`}>
      {check.phone ? <Badge label={t('wifitools:security.phone')} tone="accent" /> : null}
      <AppText variant="subhead" tone="secondary">
        {t(`wifitools:security.levelHint.${check.level}`)}
      </AppText>
      {check.findings.length ? (
        <View style={styles.findings}>
          {check.findings.map((f) => (
            <View key={f.kind} style={styles.finding}>
              <Icon
                name={FINDING_ICON[f.kind]}
                size={16}
                color={
                  f.kind === 'hidden'
                    ? colors.textSecondary
                    : f.kind === 'password' && f.strength === 'strong'
                      ? colors.success
                      : colors.warning
                }
              />
              <AppText variant="subhead" style={styles.flex}>
                <FindingText finding={f} />
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {noWpa3 ? (
        <AppText variant="footnote" tone="tertiary">
          {sae === false ? t('wifitools:security.noSae') : t('wifitools:security.saeUnknown')}
        </AppText>
      ) : null}
      {check.fixes.length ? (
        <GlassButton
          label={t('wifitools:security.fix', { count: check.fixes.length })}
          icon="shield"
          variant="primary"
          disabled={busy}
          loading={busy}
          onPress={onFix}
          testID={`security-fix-${check.routerId}-${check.section}`}
        />
      ) : (
        <AppText variant="subhead" tone="success">
          {t('wifitools:security.ok')}
        </AppText>
      )}
      {renewed ? (
        <GlassButton label={t('wifitools:security.share')} icon="qrcode" onPress={onShare} testID="security-share" />
      ) : null}
    </GlassCard>
  );
}

/** The fixes to apply (all ticked at first), a new password when one is needed, and the SSID sync. */
function FixSheet({
  check,
  plan,
  onCancel,
  onApply,
}: {
  check: NetworkCheck;
  plan(fixes: SecurityFix[], key: string | undefined, sync: boolean): FixPlan;
  onCancel(): void;
  onApply(plan: FixPlan, key?: string): void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<ReadonlySet<SecurityFix>>(new Set(check.fixes));
  const [key, setKey] = useState(() => generatePassword());
  const [sync, setSync] = useState(true);
  const fixes = check.fixes.filter((f) => chosen.has(f));
  const needsKey = fixes.some((f) => fixNeedsKey(check.network, f));
  // Judged here on the phone; the password only ever goes to the router.
  const strength = passwordStrength(key, check.ssid);
  const keyIssue = needsKey
    ? validateNetwork({ ssid: check.ssid, encryption: 'psk2', key }).length
      ? t('wifitools:security.keyLength')
      : strength.strength === 'weak'
        ? t('wifitools:security.keyWeak')
        : undefined
    : undefined;
  // An emptied field must not throw mid-typing (planning needs some key); saving waits for a valid one.
  const result = plan(fixes, needsKey ? key || '-' : undefined, sync);
  const toggle = (fix: SecurityFix, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(fix);
      else next.delete(fix);
      return next;
    });

  return (
    <EditSheet
      title={t('wifitools:security.sheetTitle', { ssid: check.ssid })}
      saveLabel={t('wifitools:security.apply')}
      saveDisabled={!fixes.length || !!keyIssue || !result.steps.length}
      onCancel={onCancel}
      onSave={() => onApply(result, needsKey ? key : undefined)}
      testID="security-sheet">
      <ListSection>
        {check.fixes.map((fix) => (
          <ListRow
            key={fix}
            title={t(`wifitools:security.fixes.${fix}`)}
            subtitle={fix === 'upgrade-wpa3' ? t('wifitools:security.wpa3Hint') : undefined}
            switchValue={chosen.has(fix)}
            onSwitch={(on) => toggle(fix, on)}
          />
        ))}
      </ListSection>
      {needsKey ? (
        <>
          <TextField
            label={t('wifitools:security.newPassword')}
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={keyIssue}
            hint={
              keyIssue
                ? undefined
                : t('wifitools:security.strengthIs', {
                    strength: t(`wifitools:security.strength.${strength.strength}`),
                  })
            }
            testID="security-key"
          />
          <GlassButton
            label={t('wifitools:security.regenerate')}
            icon="refresh"
            onPress={() => setKey(generatePassword())}
          />
        </>
      ) : null}
      {result.twins.length ? (
        <ListSection footer={t('wireless:sync.hint')}>
          <ListRow
            title={t('wireless:sync.title', { count: result.twins.length })}
            subtitle={result.twins.map((tw) => `${tw.routerName} · ${bandLabel(t, tw.band)}`).join('\n')}
            icon="sync"
            switchValue={sync}
            onSwitch={setSync}
            testID="security-sync"
          />
        </ListSection>
      ) : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  card: { gap: spacing.s },
  findings: { gap: spacing.xs },
  finding: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s },
  flex: { flex: 1 },
});
