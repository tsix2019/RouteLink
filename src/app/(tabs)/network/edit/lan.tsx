import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import {
  getLanWan,
  lanChanges,
  leasesOutside,
  validateLan,
  type LanConfig,
  type LanInput,
} from '@/api/services/interfaces-config';
import { pickWan } from '@/api/services/network';
import { stageAndApply, type ApplyOutcome, type UciSection } from '@/api/uci';
import { movedBaseUrl } from '@/features/network/lanAddress';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useInterfaces, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { intToIp, ipToInt, isIPv4, netmaskToPrefix } from '@/utils/net';

const maskOf = (prefix: number) => intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/** NW-2: the LAN address and the DHCP pool. Moving the router is confirmed at its new address (A6). */
export default function EditLan() {
  const t = useT();
  const config = useRouterQuery(['lan-wan'], getLanWan);
  const lan = config.data?.lan;
  return lan ? (
    <LanForm key={`${lan.ipaddr}/${lan.prefix}`} lan={lan} dhcpValues={config.data?.dhcpValues ?? {}} />
  ) : (
    <Screen title={t('network:edit.lanTitle')}>
      {config.isError ? (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      ) : (
        <View style={styles.loading}>
          <Skeleton height={160} radius={22} />
        </View>
      )}
    </Screen>
  );
}

function LanForm({ lan, dhcpValues }: { lan: LanConfig; dhcpValues: Record<string, UciSection> }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const { router } = useActiveRouter();
  const wanIface = pickWan(useInterfaces().data ?? []);
  const wan = wanIface?.ipv4[0] ? { ipaddr: wanIface.ipv4[0].address, prefix: wanIface.ipv4[0].mask } : undefined;
  const [input, setInput] = useState<LanInput>({
    ipaddr: lan.ipaddr,
    netmask: maskOf(lan.prefix),
    dhcp: lan.dhcp?.enabled ?? false,
    start: String(lan.dhcp?.start ?? 100),
    limit: String(lan.dhcp?.limit ?? 150),
    leasetime: lan.dhcp?.leasetime ?? '12h',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateLan>>({});
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<LanInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof LanInput) => (errors[key] ? t(`network:edit.error.${errors[key]}`) : undefined);

  const newIp = input.ipaddr.trim();
  let newPrefix = lan.prefix;
  try {
    newPrefix = netmaskToPrefix(input.netmask.trim());
  } catch {
    // validation reports it
  }
  const moving = newIp !== lan.ipaddr || newPrefix !== lan.prefix;
  const move = router && !router.isDemo ? movedBaseUrl(router.baseUrl, lan.ipaddr, newIp) : undefined;
  const stranded = moving && isIPv4(newIp) ? leasesOutside(dhcpValues, newIp, newPrefix) : [];

  const save = useRouterMutation(
    (conn) =>
      stageAndApply(conn, lanChanges(input, lan), {
        mode: 'rollback',
        // Give the phone time to reconnect and get an address in the new network.
        ...(moving ? { timeoutSec: 120, confirmAt: move?.confirmAt } : {}),
      }),
    [['lan-wan'], ['interfaces'], ['clients']],
  );
  const report = async (outcome: ApplyOutcome) => {
    if (outcome.status === 'rolled-back') {
      toast(t('network:result.rolledBack'), 'warning');
      return;
    }
    if (moving && move?.updateProfile && router?.profile) {
      await useRouters.getState().update(router.profile.id, { baseUrl: move.confirmAt });
    }
    toast(moving ? t('network:edit.moved', { ip: newIp }) : t('network:result.applied'));
    nav.back();
  };

  const submit = () => {
    const found = validateLan(input, wan);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!lanChanges(input, lan).length) {
      toast(t('network:edit.noChanges'), 'info');
      return;
    }
    setConfirming(true);
  };

  const pool = (() => {
    if (!isIPv4(newIp) || !/^\d+$/.test(input.start) || !/^\d+$/.test(input.limit)) return null;
    const network = (ipToInt(newIp) & ipToInt(maskOf(newPrefix))) >>> 0;
    return t('network:edit.pool', {
      first: intToIp(network + Number(input.start)),
      last: intToIp(network + Number(input.start) + Number(input.limit) - 1),
    });
  })();

  return (
    <>
      <Screen title={t('network:edit.lanTitle')}>
        <GlassCard contentStyle={styles.form}>
          <TextField
            label={t('network:edit.ipaddr')}
            value={input.ipaddr}
            onChangeText={(v) => set({ ipaddr: v })}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={err('ipaddr')}
            testID="lan-ip"
          />
          <TextField
            label={t('network:edit.netmask')}
            value={input.netmask}
            onChangeText={(v) => set({ netmask: v })}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={err('netmask')}
          />
        </GlassCard>
        {lan.dhcp ? (
          <>
            <ListSection footer={t('network:edit.dhcpHint')}>
              <ListRow title={t('network:edit.dhcp')} switchValue={input.dhcp} onSwitch={(v) => set({ dhcp: v })} />
            </ListSection>
            {input.dhcp ? (
              <GlassCard contentStyle={styles.form}>
                <TextField
                  label={t('network:edit.start')}
                  value={input.start}
                  onChangeText={(v) => set({ start: v })}
                  hint={t('network:edit.startHint')}
                  keyboardType="number-pad"
                  error={err('start')}
                />
                <TextField
                  label={t('network:edit.limit')}
                  value={input.limit}
                  onChangeText={(v) => set({ limit: v })}
                  hint={pool ?? undefined}
                  keyboardType="number-pad"
                  error={err('limit')}
                />
                <TextField
                  label={t('network:edit.leasetime')}
                  value={input.leasetime}
                  onChangeText={(v) => set({ leasetime: v })}
                  hint={t('network:edit.leasetimeHint')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={err('leasetime')}
                />
              </GlassCard>
            ) : null}
          </>
        ) : null}
        <GlassButton
          label={t('network:edit.save')}
          variant="primary"
          disabled={save.isPending}
          onPress={submit}
          testID="lan-save"
        />
      </Screen>
      <RiskConfirm
        visible={confirming}
        level={moving ? 'high' : 'medium'}
        disruptive
        title={moving ? t('network:edit.moveConfirm', { ip: newIp }) : t('network:edit.lanConfirm')}
        consequences={
          moving
            ? [
                t('network:edit.moveConsequences.reconnect'),
                t('network:edit.moveConsequences.static'),
                ...(stranded.length
                  ? [
                      t('network:edit.moveConsequences.leases', {
                        list: stranded.map((s) => `${s.name} (${s.ip})`).join(', '),
                      }),
                    ]
                  : []),
                t('network:edit.moveConsequences.undo'),
              ]
            : [t('network:edit.dhcpConsequence'), t('network:edit.wanConsequence')]
        }
        confirmLabel={t('network:edit.save')}
        onConfirm={() => {
          setConfirming(false);
          save.mutate(undefined, {
            onSuccess: (o) => void report(o),
            onError: (e) => toast(describeError(t, e).title, 'error'),
          });
        }}
        onCancel={() => setConfirming(false)}
      />
      {save.isPending && moving ? <MovingNotice ip={newIp} /> : null}
    </>
  );
}

/** While the change waits for confirmation at the new address: tell the user to reconnect. */
function MovingNotice({ ip }: { ip: string }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <NoBlurTarget>
        <View style={[styles.scrim, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
          <GlassSurface variant="floating" style={styles.notice}>
            <AppText variant="title" align="center">
              {t('network:edit.moving', { ip })}
            </AppText>
            <AppText variant="body" align="center" style={{ color: colors.textSecondary }}>
              {t('network:edit.movingHint')}
            </AppText>
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  form: { gap: spacing.m },
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  notice: { padding: spacing.xl, gap: spacing.m },
});
