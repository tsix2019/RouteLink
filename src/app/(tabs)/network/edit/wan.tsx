import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  getLanWan,
  validateWan,
  wanChanged,
  wanChanges,
  WAN_PROTOS,
  type WanConfig,
  type WanInput,
  type WanProto,
} from '@/api/services/interfaces-config';
import { stageAndApply, type ApplyOutcome } from '@/api/uci';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** NW-2: the WAN interface — DHCP, static or PPPoE, own DNS servers, MTU. */
export default function EditWan() {
  const t = useT();
  const config = useRouterQuery(['lan-wan'], getLanWan);
  const wan = config.data?.wan;
  return wan ? (
    <WanForm key={wan.section} wan={wan} lan={config.data?.lan} />
  ) : (
    <Screen title={t('network:edit.wanTitle')}>
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

function WanForm({ wan, lan }: { wan: WanConfig; lan?: { ipaddr: string; prefix: number } }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const editable = (WAN_PROTOS as string[]).includes(wan.proto);
  const [input, setInput] = useState<WanInput>({
    proto: editable ? (wan.proto as WanProto) : 'dhcp',
    ipaddr: wan.ipaddr ?? '',
    netmask: wan.netmask ?? '255.255.255.0',
    gateway: wan.gateway ?? '',
    username: wan.username ?? '',
    password: wan.password ?? '',
    dns: wan.dns.join(' '),
    mtu: wan.mtu ?? '',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateWan>>({});
  const [confirming, setConfirming] = useState(false);
  const save = useRouterMutation(
    (conn, i: WanInput) => stageAndApply(conn, wanChanges(i, wan), { mode: 'rollback' }),
    [['lan-wan'], ['interfaces']],
  );
  const set = (patch: Partial<WanInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof WanInput) => (errors[key] ? t(`network:edit.error.${errors[key]}`) : undefined);
  const report = (outcome: ApplyOutcome) => {
    if (outcome.status === 'rolled-back') toast(t('network:result.rolledBack'), 'warning');
    else {
      toast(t('network:result.applied'));
      nav.back();
    }
  };
  const submit = () => {
    const found = validateWan(input, lan);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!wanChanged(input, wan)) {
      toast(t('network:edit.noChanges'), 'info');
      return;
    }
    setConfirming(true);
  };

  return (
    <>
      <Screen title={t('network:edit.wanTitle')}>
        {!editable ? (
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:edit.otherProto', { proto: wan.proto })}
          </AppText>
        ) : null}
        <AppText variant="footnote" tone="secondary" style={styles.note}>
          {t('network:edit.protocol')}
        </AppText>
        <Segmented
          values={WAN_PROTOS.map((p) => t(`network:edit.protos.${p}`))}
          selectedIndex={WAN_PROTOS.indexOf(input.proto)}
          onChange={(e) => set({ proto: WAN_PROTOS[e.nativeEvent.selectedSegmentIndex] })}
        />
        {input.proto === 'static' ? (
          <GlassCard contentStyle={styles.form}>
            <TextField
              label={t('network:edit.ipaddr')}
              value={input.ipaddr}
              onChangeText={(v) => set({ ipaddr: v })}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              monospace
              error={err('ipaddr')}
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
            <TextField
              label={t('network:edit.gateway')}
              value={input.gateway}
              onChangeText={(v) => set({ gateway: v })}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              monospace
              error={err('gateway')}
            />
          </GlassCard>
        ) : null}
        {input.proto === 'pppoe' ? (
          <GlassCard contentStyle={styles.form}>
            <TextField
              label={t('network:edit.username')}
              value={input.username}
              onChangeText={(v) => set({ username: v })}
              autoCapitalize="none"
              autoCorrect={false}
              error={err('username')}
            />
            <TextField
              label={t('network:edit.password')}
              value={input.password}
              onChangeText={(v) => set({ password: v })}
              secret
            />
          </GlassCard>
        ) : null}
        <GlassCard contentStyle={styles.form}>
          <TextField
            label={t('network:edit.dns')}
            value={input.dns}
            onChangeText={(v) => set({ dns: v })}
            placeholder="223.5.5.5 119.29.29.29"
            hint={t('network:edit.dnsHint')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('dns')}
          />
          <TextField
            label={t('network:edit.mtu')}
            value={input.mtu}
            onChangeText={(v) => set({ mtu: v })}
            placeholder={t('network:edit.mtuHint')}
            keyboardType="number-pad"
            error={err('mtu')}
          />
        </GlassCard>
        <GlassButton
          label={t('network:edit.save')}
          variant="primary"
          disabled={save.isPending}
          loading={save.isPending}
          onPress={submit}
          testID="wan-save"
        />
      </Screen>
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('network:edit.wanConfirm')}
        consequences={[t('network:edit.wanConsequence')]}
        confirmLabel={t('network:edit.save')}
        onConfirm={() => {
          setConfirming(false);
          save.mutate(input, { onSuccess: report, onError: (e) => toast(describeError(t, e).title, 'error') });
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
  form: { gap: spacing.m },
});
