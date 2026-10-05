import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { bandOf } from '@/api/services/clients';
import {
  createGuestChanges,
  deleteGuestChanges,
  getGuestState,
  guestWifiChanges,
  type GuestInput,
  type GuestState,
} from '@/api/services/guest';
import { stageAndApply, type ApplyOutcome } from '@/api/uci';
import type { UbusCall } from '@/api/ubus/types';
import { bandLabel } from '@/features/wireless/labels';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const SECURITY: GuestInput['encryption'][] = ['sae-mixed', 'psk2', 'none'];

/** A password guests can type: no look-alike characters. */
function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type Pending = { title: string; consequence: string; changes: UbusCall[] };

/** WL-5: guest Wi-Fi on routers that both have radios and route to the internet. */
export default function GuestNetwork() {
  const t = useT();
  const toast = useToast();
  const nav = useRouter();
  const state = useRouterQuery(['guest'], getGuestState);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reveal, setReveal] = useState(false);
  const apply = useRouterMutation(
    (conn, changes: UbusCall[]) => stageAndApply(conn, changes, { mode: 'rollback' }),
    [['guest'], ['radios']],
  );
  const report = (outcome: ApplyOutcome) =>
    toast(outcome.status === 'rolled-back' ? t('wireless:result.rolledBack') : t('wireless:result.applied'));

  const s = state.data;
  const guest = s?.guest;
  const enabled = !!guest?.wifi.some((w) => !w.disabled);

  return (
    <>
      <Screen title={t('wireless:guest.title')} inTabs onRefresh={() => state.refetch()}>
        {!s ? (
          state.isError ? (
            <ErrorState error={state.error} onRetry={() => void state.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )
        ) : s.support.status !== 'ok' ? (
          <EmptyState
            icon="guest"
            title={t('wireless:guest.title')}
            message={s.support.status === 'no-wifi' ? t('wireless:guest.noWifi') : t('wireless:guest.notGateway')}
          />
        ) : guest ? (
          <>
            <ListSection footer={t('wireless:guest.intro')}>
              <ListRow
                title={t('wireless:guest.on')}
                icon="guest"
                switchValue={enabled}
                onSwitch={(on) =>
                  setPending({
                    title: t('wireless:guest.toggleTitle', { state: on ? t('on') : t('off') }),
                    consequence: t('wireless:guest.createConsequence'),
                    changes: guestWifiChanges(guest, on),
                  })
                }
                testID="guest-switch"
              />
              <ListRow title={t('wireless:guest.ssid')} value={guest.wifi[0]?.ssid} />
              {guest.wifi[0]?.key ? (
                <ListRow
                  title={t('wireless:guest.password')}
                  value={reveal ? guest.wifi[0].key : '••••••••'}
                  icon={reveal ? 'eyeOff' : 'eye'}
                  onPress={() => setReveal((v) => !v)}
                />
              ) : null}
              <ListRow title={t('wireless:guest.radios')} value={guest.wifi.map((w) => w.radio).join(', ')} />
              {guest.ipaddr ? (
                <ListRow title={t('wireless:guest.subnet')} value={`${guest.ipaddr}/${guest.prefix ?? 24}`} />
              ) : null}
            </ListSection>
            {guest.wifi[0] ? (
              <GlassButton
                label={t('wireless:guest.share')}
                icon="qrcode"
                onPress={() => nav.push(`/wifi-qr?section=${encodeURIComponent(guest.wifi[0].section)}`)}
              />
            ) : null}
            <GlassButton
              label={t('wireless:guest.delete')}
              icon="trash"
              variant="warning"
              disabled={apply.isPending}
              onPress={() =>
                setPending({
                  title: t('wireless:guest.deleteTitle'),
                  consequence: t('wireless:guest.deleteConsequence'),
                  changes: deleteGuestChanges(s.configs),
                })
              }
              testID="guest-delete"
            />
          </>
        ) : (
          <CreateForm
            state={s}
            busy={apply.isPending}
            onCreate={(input) =>
              setPending({
                title: t('wireless:guest.createTitle', { ssid: input.ssid }),
                consequence: t('wireless:guest.createConsequence'),
                changes: createGuestChanges(input, {
                  style: s.style,
                  wanZone: s.support.status === 'ok' ? s.support.wanZone : 'wan',
                }),
              })
            }
          />
        )}
      </Screen>
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={pending ? [pending.consequence] : []}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p)
            apply.mutate(p.changes, { onSuccess: report, onError: (e) => toast(describeError(t, e).title, 'error') });
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function CreateForm({
  state,
  busy,
  onCreate,
}: {
  state: GuestState;
  busy: boolean;
  onCreate(input: GuestInput): void;
}) {
  const t = useT();
  const [input, setInput] = useState<GuestInput>(() => ({
    ssid: `${state.mainSsid ?? 'OpenWrt'}-Guest`.slice(0, 32),
    encryption: 'sae-mixed',
    key: randomPassword(),
    radios: state.radios.map((r) => r.name),
    ipaddr: state.freeAddress,
    isolate: true,
  }));
  const [errors, setErrors] = useState<{ ssid?: string; key?: string; radios?: string }>({});
  const set = (patch: Partial<GuestInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const submit = () => {
    const found = {
      ssid:
        !input.ssid.trim() || new TextEncoder().encode(input.ssid).length > 32
          ? t('wireless:guest.error.ssid')
          : undefined,
      key: input.encryption !== 'none' && input.key.length < 8 ? t('wireless:guest.error.password') : undefined,
      radios: input.radios.length ? undefined : t('wireless:guest.error.radios'),
    };
    setErrors(found);
    if (!found.ssid && !found.key && !found.radios) onCreate({ ...input, ssid: input.ssid.trim() });
  };

  return (
    <>
      <AppText variant="subhead" tone="secondary" style={styles.note}>
        {t('wireless:guest.intro')}
      </AppText>
      <GlassCard contentStyle={styles.form}>
        <TextField
          label={t('wireless:guest.ssid')}
          value={input.ssid}
          onChangeText={(v) => set({ ssid: v })}
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.ssid}
          testID="guest-ssid"
        />
        <AppText variant="footnote" tone="secondary">
          {t('wireless:guest.security')}
        </AppText>
        <Segmented
          values={SECURITY.map((x) => t(`wireless:guest.security_options.${x}`))}
          selectedIndex={SECURITY.indexOf(input.encryption)}
          onChange={(e) => set({ encryption: SECURITY[e.nativeEvent.selectedSegmentIndex] })}
        />
        {input.encryption !== 'none' ? (
          <TextField
            label={t('wireless:guest.password')}
            value={input.key}
            onChangeText={(v) => set({ key: v })}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={errors.key}
            testID="guest-key"
          />
        ) : null}
      </GlassCard>
      <ListSection title={t('wireless:guest.radios')} footer={errors.radios}>
        {state.radios.map((r) => (
          <ListRow
            key={r.name}
            title={bandLabel(t, bandOf({ band: r.band }))}
            subtitle={r.name}
            switchValue={input.radios.includes(r.name)}
            onSwitch={(on) =>
              set({ radios: on ? [...input.radios, r.name] : input.radios.filter((x) => x !== r.name) })
            }
          />
        ))}
      </ListSection>
      <ListSection footer={t('wireless:guest.isolateHint')}>
        <ListRow
          title={t('wireless:guest.isolate')}
          switchValue={input.isolate}
          onSwitch={(v) => set({ isolate: v })}
        />
        <ListRow title={t('wireless:guest.subnet')} value={`${input.ipaddr}/24`} />
      </ListSection>
      <GlassButton
        label={t('wireless:guest.create')}
        icon="plus"
        variant="primary"
        disabled={busy}
        onPress={submit}
        testID="guest-create"
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
  form: { gap: spacing.m },
});
