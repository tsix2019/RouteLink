import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  getSqm,
  queueChanges,
  saveSqm,
  SQM_SCRIPTS,
  validateQueue,
  type LinkLayer,
  type SqmInput,
  type SqmState,
} from '@/api/services/sqm';
import type { UbusCall } from '@/api/ubus/types';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { Badge } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const LINK_LAYERS: LinkLayer[] = ['none', 'ethernet', 'atm'];
const scriptKey = (script: string) => script.replace(/\.qos$/, '') as 'piece_of_cake';
const mbit = (n: number) => String(Math.round(n * 100) / 100);

/** NW-10: the first SQM queue — the usual setup, one queue on the WAN. */
export default function Sqm() {
  const t = useT();
  const state = useRouterQuery(['sqm'], getSqm, { refetchInterval: 10_000 });
  const data = state.data;
  return (
    <Screen
      title={t('network:sqm.title')}
      onRefresh={() => state.refetch()}
      top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
      <FeatureGate feature="network.sqm" icon="speed">
        <AppText variant="footnote" tone="secondary" style={styles.note}>
          {t('network:sqm.intro')}
        </AppText>
        {data ? (
          <SqmForm key={data.queues[0]?.section ?? 'new'} state={data} />
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
      </FeatureGate>
    </Screen>
  );
}

function SqmForm({ state }: { state: SqmState }) {
  const t = useT();
  const toast = useToast();
  const queue = state.queues[0];
  const [input, setInput] = useState<SqmInput>({
    enabled: queue?.enabled ?? true,
    interface: queue?.interface || state.wanDevice || '',
    download: queue ? mbit(queue.download) : '',
    upload: queue ? mbit(queue.upload) : '',
    script:
      queue?.script && (SQM_SCRIPTS as readonly string[]).includes(queue.script) ? queue.script : 'piece_of_cake.qos',
    linklayer: (LINK_LAYERS as string[]).includes(String(queue?.linklayer)) ? (queue!.linklayer as LinkLayer) : 'none',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateQueue>>({});
  const [picker, setPicker] = useState<'interface' | 'script' | null>(null);
  const [pending, setPending] = useState<UbusCall[] | null>(null);
  const save = useRouterMutation((conn, changes: UbusCall[]) => saveSqm(conn, changes), [['sqm']]);
  const set = (patch: Partial<SqmInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof SqmInput) => (errors[key] ? t(`network:sqm.error.${errors[key]!}`) : undefined);

  return (
    <>
      <GlassCard contentStyle={styles.status}>
        <AppText variant="headline" style={styles.flex}>
          {input.interface || '—'}
        </AppText>
        <Badge
          label={queue?.active ? t('network:sqm.active') : t('network:sqm.inactive')}
          tone={queue?.active ? 'success' : undefined}
        />
      </GlassCard>
      <ListSection>
        <ListRow
          title={t('network:sqm.enabled')}
          switchValue={input.enabled}
          onSwitch={(enabled) => set({ enabled })}
          testID="sqm-enabled"
        />
        <ListRow
          title={t('network:sqm.interface')}
          subtitle={t('network:sqm.interfaceHint')}
          value={input.interface || '—'}
          chevron
          onPress={() => setPicker('interface')}
        />
        <ListRow
          title={t('network:sqm.script')}
          value={t(`network:sqm.scripts.${scriptKey(input.script)}`)}
          chevron
          onPress={() => setPicker('script')}
        />
      </ListSection>
      {err('interface') ? (
        <AppText variant="footnote" tone="danger" style={styles.note}>
          {err('interface')}
        </AppText>
      ) : null}
      <GlassCard contentStyle={styles.form}>
        <TextField
          label={t('network:sqm.download')}
          value={input.download}
          onChangeText={(download) => set({ download })}
          keyboardType="decimal-pad"
          error={err('download')}
          testID="sqm-download"
        />
        <TextField
          label={t('network:sqm.upload')}
          value={input.upload}
          onChangeText={(upload) => set({ upload })}
          keyboardType="decimal-pad"
          hint={t('network:sqm.rateHint')}
          error={err('upload')}
          testID="sqm-upload"
        />
      </GlassCard>
      <AppText variant="footnote" tone="secondary" style={styles.note}>
        {t('network:sqm.linklayer')}
      </AppText>
      <Segmented
        values={LINK_LAYERS.map((l) => t(`network:sqm.linklayers.${l}`))}
        selectedIndex={LINK_LAYERS.indexOf(input.linklayer)}
        onChange={(e) => set({ linklayer: LINK_LAYERS[e.nativeEvent.selectedSegmentIndex] })}
      />
      <GlassButton
        label={t('network:sqm.save')}
        variant="primary"
        disabled={save.isPending}
        loading={save.isPending}
        onPress={() => {
          const found = validateQueue(input);
          setErrors(found);
          if (!Object.keys(found).length) setPending(queueChanges(input, queue));
        }}
        testID="sqm-save"
      />

      <SelectSheet
        visible={picker === 'interface'}
        title={t('network:sqm.interface')}
        options={state.devices.map((d) => ({
          value: d,
          label: d,
          detail: d === state.wanDevice ? 'WAN' : undefined,
        }))}
        value={input.interface}
        onSelect={(value) => {
          set({ interface: value });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'script'}
        title={t('network:sqm.script')}
        options={SQM_SCRIPTS.filter(
          (s) => !s.includes('cake') || state.qdiscs.includes('cake') || !state.qdiscs.length,
        ).map((s) => ({ value: s, label: t(`network:sqm.scripts.${scriptKey(s)}`), detail: s }))}
        value={input.script}
        onSelect={(script) => {
          set({ script });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        title={t('network:sqm.confirmTitle')}
        consequences={[t('network:sqm.consequence')]}
        confirmLabel={t('network:sqm.save')}
        onConfirm={() => {
          const changes = pending;
          setPending(null);
          if (changes) {
            save.mutate(changes, {
              onSuccess: () => toast(t('network:sqm.saved')),
              onError: (e) => toast(describeError(t, e).title, 'error'),
            });
          }
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  flex: { flex: 1 },
  form: { gap: spacing.m },
});
