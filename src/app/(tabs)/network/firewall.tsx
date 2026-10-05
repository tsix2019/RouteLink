import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  applyFirewallChanges,
  deleteSectionChanges,
  getFirewall,
  portForwardChanges,
  setEnabledChanges,
  trafficRuleChanges,
  type PortForward,
  type TrafficRule,
} from '@/api/services/firewall';
import type { UbusCall } from '@/api/ubus/types';
import type { ApplyOutcome } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ForwardSheet } from '@/features/network/ForwardSheet';
import { RuleSheet } from '@/features/network/RuleSheet';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useClients, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { Segmented } from '@/ui/Segmented';

type Tab = 'forwards' | 'rules' | 'zones';
const TABS: Tab[] = ['forwards', 'rules', 'zones'];

type Item = { kind: 'forward'; forward: PortForward } | { kind: 'rule'; rule: TrafficRule };
type Pending = { title: string; changes: UbusCall[]; expose?: boolean };

/** NW-6: port forwards and traffic rules (add, edit, switch, delete) and the zones (read-only). */
export default function Firewall() {
  const t = useT();
  const toast = useToast();
  const fw = useRouterQuery(['firewall'], getFirewall);
  const clients = useClients();
  const [tab, setTab] = useState<Tab>('forwards');
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | { kind: 'new-forward' } | { kind: 'new-rule' } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const apply = useRouterMutation((conn, changes: UbusCall[]) => applyFirewallChanges(conn, changes), [['firewall']]);

  const report = (outcome: ApplyOutcome) =>
    outcome.status === 'rolled-back'
      ? toast(t('network:result.rolledBack'), 'warning')
      : toast(t('network:result.applied'));
  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');

  const name = (item: Item) =>
    (item.kind === 'forward' ? item.forward.name : item.rule.name) || t('network:firewall.unnamed');
  const zone = (z: string | undefined) =>
    z === undefined ? t('network:firewall.thisRouter') : z === '*' ? t('network:firewall.anyZone') : z;
  const protoText = (p: string[]) =>
    p.map((x) => (x === 'all' ? t('network:firewall.proto.all') : x.toUpperCase())).join('/');
  const forwardDetail = (f: PortForward) =>
    `${f.srcZone}:${f.externalPort} → ${f.internalIp}:${f.internalPort ?? f.externalPort} · ${protoText(f.protocols)}`;
  const ruleDetail = (r: TrafficRule) =>
    [
      `${zone(r.src)} → ${zone(r.dest)}`,
      protoText(r.protocols),
      r.destPort,
      t(`network:firewall.target.${r.target as 'ACCEPT'}`, { defaultValue: r.target }),
    ]
      .filter(Boolean)
      .join(' · ');

  const policy = (p: string) => t(`network:firewall.target.${p as 'ACCEPT'}`, { defaultValue: p });

  const toggle = (item: Item, enabled: boolean) => {
    const section = item.kind === 'forward' ? item.forward.section : item.rule.section;
    setPending({
      title: t(enabled ? 'network:firewall.enableTitle' : 'network:firewall.disableTitle', { name: name(item) }),
      changes: setEnabledChanges(section, enabled),
      expose: enabled && item.kind === 'forward',
    });
  };

  const data = fw.data;
  return (
    <>
      <Screen
        title={t('network:firewall.title')}
        onRefresh={() => fw.refetch()}
        top={data ? <ConnectionBanner error={fw.error} onRetry={() => void fw.refetch()} /> : null}>
        <FeatureGate feature="network.firewall" icon="firewall">
          <Segmented
            values={TABS.map((x) => t(`network:firewall.${x}`))}
            selectedIndex={TABS.indexOf(tab)}
            onChange={(e) => setTab(TABS[e.nativeEvent.selectedSegmentIndex])}
          />
          {data ? (
            tab === 'forwards' ? (
              <>
                <ListSection footer={t('network:firewall.forwardsHint')}>
                  {data.forwards.length ? (
                    data.forwards.map((f) => (
                      <ListRow
                        key={f.section}
                        title={f.name || t('network:firewall.unnamed')}
                        subtitle={forwardDetail(f)}
                        switchValue={f.enabled}
                        onSwitch={(v) => toggle({ kind: 'forward', forward: f }, v)}
                        onPress={() => setSelected({ kind: 'forward', forward: f })}
                        testID={`forward-${f.section}`}
                      />
                    ))
                  ) : (
                    <ListRow title={t('network:firewall.noForwards')} disabled />
                  )}
                </ListSection>
                <GlassButton
                  label={t('network:firewall.addForward')}
                  icon="plus"
                  disabled={apply.isPending}
                  onPress={() => setEditing({ kind: 'new-forward' })}
                  testID="forward-add"
                />
              </>
            ) : tab === 'rules' ? (
              <>
                <ListSection footer={data.rules.some((r) => r.managed) ? t('network:firewall.managedHint') : undefined}>
                  {data.rules.length ? (
                    data.rules.map((r) => (
                      <ListRow
                        key={r.section}
                        title={r.name || t('network:firewall.unnamed')}
                        subtitle={ruleDetail(r)}
                        right={
                          r.managed ? (
                            <Badge label={t('network:firewall.managed')} tone="accent" />
                          ) : r.extra.length ? (
                            <Badge label={t('network:firewall.advanced')} />
                          ) : undefined
                        }
                        switchValue={r.managed ? undefined : r.enabled}
                        onSwitch={r.managed ? undefined : (v) => toggle({ kind: 'rule', rule: r }, v)}
                        onPress={r.managed ? undefined : () => setSelected({ kind: 'rule', rule: r })}
                        testID={`rule-${r.section}`}
                      />
                    ))
                  ) : (
                    <ListRow title={t('network:firewall.noRules')} disabled />
                  )}
                </ListSection>
                <GlassButton
                  label={t('network:firewall.addRule')}
                  icon="plus"
                  disabled={apply.isPending}
                  onPress={() => setEditing({ kind: 'new-rule' })}
                  testID="rule-add"
                />
              </>
            ) : (
              <>
                {data.zones.map((z) => (
                  <ListSection key={z.section} title={z.name}>
                    <ListRow
                      title={z.networks.join(', ') || '—'}
                      subtitle={t('network:firewall.policy', {
                        input: policy(z.input),
                        output: policy(z.output),
                        forward: policy(z.forward),
                      })}
                      right={z.masq ? <Badge label={t('network:firewall.masq')} tone="accent" /> : undefined}
                    />
                  </ListSection>
                ))}
                <ListSection title={t('network:firewall.forwardings')}>
                  {data.forwardings.map((f) => (
                    <ListRow
                      key={f.section}
                      title={t('network:firewall.forwarding', { src: f.src, dest: f.dest })}
                      disabled={!f.enabled}
                    />
                  ))}
                </ListSection>
              </>
            )
          ) : fw.isError ? (
            <ErrorState error={fw.error} onRetry={() => void fw.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!selected}
        title={selected ? name(selected) : undefined}
        actions={
          selected
            ? [
                {
                  label:
                    selected.kind === 'forward' ? t('network:firewall.editForward') : t('network:firewall.editRule'),
                  icon: 'edit' as const,
                  onPress: () => {
                    setEditing(selected);
                    setSelected(null);
                  },
                },
                {
                  label: t('network:firewall.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    setPending({
                      title: t('network:firewall.deleteTitle', { name: name(selected) }),
                      changes: deleteSectionChanges(
                        selected.kind === 'forward' ? selected.forward.section : selected.rule.section,
                      ),
                    });
                    setSelected(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      {data && editing && (editing.kind === 'forward' || editing.kind === 'new-forward') ? (
        <ForwardSheet
          forward={editing.kind === 'forward' ? editing.forward : undefined}
          forwards={data.forwards}
          zones={data.zones}
          clients={clients.data ?? []}
          onSave={(input) => {
            setPending({
              title: t('network:firewall.saveTitle'),
              changes: portForwardChanges(input, editing.kind === 'forward' ? editing.forward : undefined),
              expose: true,
            });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {data && editing && (editing.kind === 'rule' || editing.kind === 'new-rule') ? (
        <RuleSheet
          rule={editing.kind === 'rule' ? editing.rule : undefined}
          zones={data.zones}
          onSave={(input) => {
            setPending({
              title: t('network:firewall.saveTitle'),
              changes: trafficRuleChanges(input, editing.kind === 'rule' ? editing.rule : undefined),
            });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[
          t('network:firewall.consequence'),
          ...(pending?.expose ? [t('network:firewall.exposeConsequence')] : []),
        ]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) apply.mutate(p.changes, { onSuccess: report, onError: fail });
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
