import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { UbusCall } from '@/api/ubus/types';
import type { ApplyOutcome } from '@/api/uci';
import {
  applyVlanChanges,
  canDisableFiltering,
  disableFilteringChanges,
  enableFilteringChanges,
  getVlans,
  validateVlans,
  vlanChanges,
  type DsaVlans,
  type PortMode,
  type SwitchVlans,
  type Vlan,
  type VlanPort,
} from '@/api/services/vlan';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { PromptSheet } from '@/ui/PromptSheet';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type Editable = DsaVlans | SwitchVlans;
type Pending = { kind: 'save' | 'enable' | 'disable'; changes: UbusCall[] };

const LABEL_WIDTH = 104;
const CELL = 52;

/** The next mode when a cell is tapped; ports that must be tagged skip "untagged". */
function nextMode(mode: PortMode, port: VlanPort): PortMode {
  if (port.needTag) return mode === 'tagged' ? 'off' : 'tagged';
  return mode === 'off' ? 'untagged' : mode === 'untagged' ? 'tagged' : 'off';
}

/** NW-3: the ports × VLANs matrix (DSA bridge VLANs or a swconfig switch), applied with rollback. */
export default function VlanScreen() {
  const t = useT();
  const toast = useToast();
  const { router } = useActiveRouter();
  const state = useRouterQuery(['vlans'], getVlans);
  const [draft, setDraft] = useState<Vlan[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Vlan | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const apply = useRouterMutation(
    (conn, changes: UbusCall[]) => applyVlanChanges(conn, changes),
    [['vlans'], ['interfaces'], ['lan-wan']],
  );

  const data = state.data;
  const editable: Editable | null = data && data.kind !== 'none' ? data : null;
  const vlans = draft ?? editable?.vlans ?? [];
  const errors = editable && draft ? validateVlans(editable, draft) : [];
  const [min, max] = editable?.kind === 'swconfig' ? [editable.minVid, editable.maxVid] : [1, 4094];

  const report = (outcome: ApplyOutcome) => {
    if (outcome.status === 'rolled-back') toast(t('network:result.rolledBack'), 'warning');
    else {
      toast(t('network:vlan.applied'));
      setDraft(null);
    }
  };

  const setCell = (vlan: Vlan, port: VlanPort) => {
    const mode = nextMode(vlan.members[port.id]?.mode ?? 'off', port);
    setDraft(
      vlans.map((v) =>
        v === vlan
          ? // Untagged doubles as the port's default (PVID) VLAN, as LuCI sets it up.
            { ...v, members: { ...v.members, [port.id]: { mode, pvid: mode === 'untagged' } } }
          : v,
      ),
    );
  };

  const save = () => {
    if (!editable || !draft || errors.length) return;
    try {
      const changes = vlanChanges(editable, draft);
      if (!changes.length) {
        setDraft(null);
        return;
      }
      setPending({ kind: 'save', changes });
    } catch (e) {
      toast(describeError(t, e).title, 'error');
    }
  };

  const bridge = editable?.kind === 'dsa' ? editable.bridge : '';
  const consequences =
    pending?.kind === 'enable'
      ? [t('network:vlan.risk.interfaces', { bridge }), t('network:vlan.risk.rollback')]
      : [t('network:vlan.risk.cut'), t('network:vlan.risk.downstream'), t('network:vlan.risk.rollback')];

  return (
    <>
      <Screen
        title={t('network:vlan.title')}
        onRefresh={() => state.refetch()}
        top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        {data ? (
          !editable ? (
            <EmptyState icon="vlan" title={t('network:vlan.none')} />
          ) : editable.kind === 'dsa' && !editable.filtering ? (
            <GlassCard contentStyle={styles.card}>
              <AppText variant="body">{t('network:vlan.filteringOff', { bridge })}</AppText>
              <AppText variant="footnote" tone="secondary">
                {editable.ports.map((p) => p.label).join(' · ')}
              </AppText>
              <GlassButton
                label={t('network:vlan.enable')}
                variant="warning"
                onPress={() => setPending({ kind: 'enable', changes: enableFilteringChanges(editable) })}
                testID="vlan-enable"
              />
            </GlassCard>
          ) : (
            <>
              <AppText variant="footnote" tone="secondary" style={styles.note}>
                {editable.kind === 'dsa'
                  ? t('network:vlan.dsaIntro', { bridge })
                  : t('network:vlan.switchIntro', { name: editable.switchName })}
              </AppText>
              <GlassCard contentStyle={styles.matrixCard}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={styles.matrixRow}>
                      <View style={[styles.labelCell, { width: LABEL_WIDTH }]} />
                      {editable.ports.map((p) => (
                        <View key={p.id} style={styles.headCell}>
                          <AppText variant="caption" tone="secondary" align="center" numberOfLines={2}>
                            {p.label}
                          </AppText>
                        </View>
                      ))}
                    </View>
                    {vlans.map((v) => (
                      <View key={v.section ?? `new-${v.id}`} style={styles.matrixRow}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setSelected(v)}
                          style={[styles.labelCell, { width: LABEL_WIDTH }]}
                          testID={`vlan-row-${v.id}`}>
                          <AppText variant="headline">VLAN {v.id}</AppText>
                          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                            {v.usedBy.length ? v.usedBy.join(', ') : t('network:vlan.unused')}
                          </AppText>
                        </Pressable>
                        {editable.ports.map((p) => (
                          <MatrixCell
                            key={p.id}
                            mode={v.members[p.id]?.mode ?? 'off'}
                            pvid={!!v.members[p.id]?.pvid}
                            onPress={() => setCell(v, p)}
                            testID={`vlan-${v.id}-${p.id}`}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </GlassCard>
              <AppText variant="footnote" tone="secondary" style={styles.note}>
                {t('network:vlan.legend')}
              </AppText>
              {errors.length ? (
                <View style={styles.note}>
                  {errors.map((e) => (
                    <AppText key={JSON.stringify(e)} variant="footnote" tone="danger">
                      {'vlan' in e
                        ? t(`network:vlan.error.${e.code}`, { vlan: e.vlan })
                        : t(`network:vlan.error.${e.code}`, {
                            port: editable.ports.find((p) => p.id === e.port)?.label ?? e.port,
                          })}
                    </AppText>
                  ))}
                </View>
              ) : null}
              <GlassButton
                label={t('network:vlan.add')}
                icon="plus"
                onPress={() => setAdding(true)}
                testID="vlan-add"
              />
              {draft ? (
                <AppText variant="footnote" tone="secondary" align="center">
                  {t('network:vlan.unsaved')}
                </AppText>
              ) : null}
              <GlassButton
                label={t('network:vlan.save')}
                variant="primary"
                disabled={!draft || errors.length > 0 || apply.isPending}
                onPress={save}
                testID="vlan-save"
              />
              {editable.kind === 'dsa' && canDisableFiltering(editable) && !draft ? (
                <GlassButton
                  label={t('network:vlan.disable')}
                  onPress={() => setPending({ kind: 'disable', changes: disableFilteringChanges(editable) })}
                />
              ) : null}
              <AppText variant="footnote" tone="tertiary" style={styles.note}>
                {t('network:vlan.interfacesHint')}
              </AppText>
            </>
          )
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
      </Screen>

      <ActionSheet
        visible={!!selected}
        title={selected ? `VLAN ${selected.id}` : undefined}
        message={selected?.usedBy.length ? t('network:vlan.inUse', { names: selected.usedBy.join(', ') }) : undefined}
        actions={
          selected
            ? [
                {
                  label: t('network:vlan.deleteVlan', { id: selected.id }),
                  icon: 'trash' as const,
                  destructive: true,
                  disabled: selected.usedBy.length > 0,
                  onPress: () => {
                    setDraft(vlans.filter((v) => v !== selected));
                    setSelected(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      <PromptSheet
        visible={adding}
        title={t('network:vlan.add')}
        hint={t('network:vlan.addPrompt', { min, max })}
        placeholder="10"
        confirmLabel={t('add')}
        inputProps={{ keyboardType: 'number-pad' }}
        validate={(value) => {
          const id = Number(value.trim());
          if (!/^\d+$/.test(value.trim()) || id < min || id > max) return t('network:vlan.error.id-invalid');
          if (vlans.some((v) => v.id === id)) return t('network:vlan.error.id-taken');
          return undefined;
        }}
        onSubmit={(value) => {
          setDraft([...vlans, { id: Number(value.trim()), members: {}, usedBy: [] }]);
          setAdding(false);
        }}
        onCancel={() => setAdding(false)}
      />
      <RiskConfirm
        visible={!!pending}
        level="high"
        title={
          pending?.kind === 'enable'
            ? t('network:vlan.confirmEnable')
            : pending?.kind === 'disable'
              ? t('network:vlan.confirmDisable')
              : t('network:vlan.confirmTitle')
        }
        consequences={consequences}
        confirmPhrase={router?.name}
        confirmLabel={t('network:vlan.confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) {
            apply.mutate(p.changes, { onSuccess: report, onError: (e) => toast(describeError(t, e).title, 'error') });
          }
        }}
        onCancel={() => setPending(null)}
      />
      <BusyOverlay visible={apply.isPending} title={t('network:vlan.applying')} hint={t('network:vlan.applyingHint')} />
    </>
  );
}

function MatrixCell({
  mode,
  pvid,
  onPress,
  testID,
}: {
  mode: PortMode;
  pvid: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const filled = mode !== 'off';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mode}
      onPress={onPress}
      testID={testID}
      style={styles.cellWrap}>
      <View
        style={[
          styles.cell,
          {
            backgroundColor: mode === 'untagged' ? colors.accent : mode === 'tagged' ? colors.fill : 'transparent',
            borderColor: filled ? colors.accent : colors.separator,
          },
        ]}>
        <AppText
          variant="headline"
          tone={mode === 'untagged' ? 'inverse' : mode === 'tagged' ? 'accent' : 'tertiary'}
          align="center">
          {mode === 'untagged' ? 'U' : mode === 'tagged' ? (pvid ? 'T*' : 'T') : '—'}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  card: { gap: spacing.m },
  note: { paddingHorizontal: spacing.l, gap: spacing.xs },
  matrixCard: { paddingVertical: spacing.s },
  matrixRow: { flexDirection: 'row', alignItems: 'center' },
  labelCell: { paddingVertical: spacing.s, paddingRight: spacing.s, gap: 2 },
  headCell: { width: CELL, paddingVertical: spacing.xs },
  cellWrap: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  cell: {
    width: 40,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
