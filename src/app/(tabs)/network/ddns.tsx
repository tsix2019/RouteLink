import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ddnsChanges,
  deleteDdnsChanges,
  getDdns,
  readProvider,
  saveDdns,
  validateDdns,
  type DdnsInput,
  type DdnsService,
} from '@/api/services/ddns';
import type { UbusCall } from '@/api/ubus/types';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useInterfaces, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { pickWan } from '@/api/services/network';
import { useT, type AppT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EditSheet } from '@/ui/EditSheet';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { StatusDot } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { isPrivateIPv4 } from '@/utils/net';

const CUSTOM = '__custom__';
const SOURCES: DdnsInput['source'][] = ['wan', 'web'];

function statusLine(t: AppT, s: DdnsService): string {
  const parts: string[] = [];
  if (s.status.ip) parts.push(t('network:ddns.registered', { ip: s.status.ip }));
  if (s.status.lastUpdate) parts.push(t('network:ddns.lastUpdate', { time: s.status.lastUpdate }));
  const next = s.status.next;
  if (next === 'verify' || next === 'once' || next === 'disabled' || next === 'stopped') {
    parts.push(t(`network:ddns.next.${next}`));
  } else if (next) parts.push(t('network:ddns.nextAt', { time: next }));
  return parts.join('\n');
}

/** NW-9: ddns-scripts services with their state; saved directly, then ddns restarts. */
export default function Ddns() {
  const t = useT();
  const toast = useToast();
  const state = useRouterQuery(['ddns'], getDdns, { refetchInterval: 15_000 });
  const wanIp = pickWan(useInterfaces().data ?? [])?.ipv4[0]?.address;
  const [editing, setEditing] = useState<{ service?: DdnsService } | null>(null);
  const [pending, setPending] = useState<{ title: string; changes: UbusCall[] } | null>(null);
  const save = useRouterMutation((conn, changes: UbusCall[]) => saveDdns(conn, changes), [['ddns']]);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');
  const commit = (changes: UbusCall[]) =>
    save.mutate(changes, { onSuccess: () => toast(t('network:ddns.saved')), onError: fail });

  const data = state.data;
  return (
    <>
      <Screen
        title={t('network:ddns.title')}
        onRefresh={() => state.refetch()}
        top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
        <FeatureGate feature="network.ddns" icon="globe">
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:ddns.intro')}
          </AppText>
          {data ? (
            <>
              <ListSection>
                {data.services.length ? (
                  data.services.map((s) => (
                    <ListRow
                      key={s.section}
                      title={s.domain || s.section}
                      subtitle={[s.provider || t('network:ddns.custom'), statusLine(t, s)].filter(Boolean).join('\n')}
                      left={<StatusDot status={s.status.running ? 'online' : 'offline'} />}
                      switchValue={s.enabled}
                      onSwitch={(enabled) =>
                        commit(
                          ddnsChanges(
                            {
                              provider: s.provider,
                              updateUrl: s.updateUrl ?? '',
                              domain: s.domain,
                              username: s.username,
                              password: s.password,
                              ipv6: s.ipv6,
                              source: s.source,
                              enabled,
                            },
                            data.sections,
                            s,
                          ),
                        )
                      }
                      onPress={() => setEditing({ service: s })}
                      testID={`ddns-${s.section}`}
                    />
                  ))
                ) : (
                  <ListRow title={t('network:ddns.empty')} disabled />
                )}
              </ListSection>
              <GlassButton
                label={t('network:ddns.add')}
                icon="plus"
                variant="primary"
                disabled={save.isPending}
                loading={save.isPending}
                onPress={() => setEditing({})}
                testID="ddns-add"
              />
            </>
          ) : state.isError ? (
            <ErrorState error={state.error} onRetry={() => void state.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1].map((i) => (
                <Skeleton key={i} height={64} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      {editing && data ? (
        <DdnsSheet
          service={editing.service}
          providers={data.providers}
          behindNat={!!wanIp && isPrivateIPv4(wanIp)}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.service
              ? () => {
                  const s = editing.service!;
                  setEditing(null);
                  setPending({
                    title: t('network:ddns.deleteTitle', { name: s.domain || s.section }),
                    changes: deleteDdnsChanges(s),
                  });
                }
              : undefined
          }
          onSave={(input) => {
            const service = editing.service;
            setEditing(null);
            commit(ddnsChanges(input, data.sections, service));
          }}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        title={pending?.title ?? ''}
        consequences={[t('network:ddns.deleteConsequence')]}
        confirmLabel={t('network:ddns.delete')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) commit(p.changes);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function DdnsSheet({
  service,
  providers,
  behindNat,
  onSave,
  onDelete,
  onCancel,
}: {
  service?: DdnsService;
  providers: string[];
  /** The WAN has a private address: a web check finds the real one. */
  behindNat: boolean;
  onSave(input: DdnsInput): void;
  onDelete?(): void;
  onCancel(): void;
}) {
  const t = useT();
  const [input, setInput] = useState<DdnsInput>({
    provider: service ? service.provider : (providers.find((p) => p === 'duckdns.org') ?? providers[0] ?? ''),
    updateUrl: service?.updateUrl ?? '',
    domain: service?.domain ?? '',
    username: service?.username ?? '',
    password: service?.password ?? '',
    ipv6: service?.ipv6 ?? false,
    source: service?.source ?? (behindNat ? 'web' : 'wan'),
    enabled: service?.enabled ?? true,
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateDdns>>({});
  const [picking, setPicking] = useState(false);
  const needs = useRouterQuery(['ddns-provider', input.provider], (conn) => readProvider(conn, input.provider), {
    enabled: !!input.provider,
    staleTime: Infinity,
  }).data;
  const set = (patch: Partial<DdnsInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof DdnsInput) => (errors[key] ? t(`network:ddns.error.${errors[key]!}`) : undefined);
  const custom = !input.provider;
  const askUser = custom ? input.updateUrl.includes('[USERNAME]') : !!needs?.username;
  const askPassword = custom ? input.updateUrl.includes('[PASSWORD]') : (needs?.password ?? true);

  return (
    <>
      <EditSheet
        title={service ? t('network:ddns.edit') : t('network:ddns.add')}
        onCancel={onCancel}
        onDelete={onDelete}
        deleteLabel={t('network:ddns.delete')}
        onSave={() => {
          const found = validateDdns(input, custom ? null : (needs ?? null));
          setErrors(found);
          if (!Object.keys(found).length) onSave(input);
        }}
        testID="ddns-sheet">
        <ListSection footer={t('network:ddns.providerHint')}>
          <ListRow
            title={t('network:ddns.provider')}
            value={input.provider || t('network:ddns.custom')}
            chevron
            onPress={() => setPicking(true)}
          />
        </ListSection>
        {custom ? (
          <TextField
            label={t('network:ddns.updateUrl')}
            value={input.updateUrl}
            onChangeText={(updateUrl) => set({ updateUrl })}
            hint={t('network:ddns.updateUrlHint')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('updateUrl')}
          />
        ) : null}
        <TextField
          label={t('network:ddns.domain')}
          value={input.domain}
          onChangeText={(domain) => set({ domain: domain.trim() })}
          hint={t('network:ddns.domainHint')}
          placeholder="myhome.duckdns.org"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={err('domain')}
        />
        {askUser ? (
          <TextField
            label={t('network:ddns.username')}
            value={input.username}
            onChangeText={(username) => set({ username })}
            autoCapitalize="none"
            autoCorrect={false}
            error={err('username')}
          />
        ) : null}
        {askPassword ? (
          <TextField
            label={t('network:ddns.password')}
            value={input.password}
            onChangeText={(password) => set({ password })}
            secret
            error={err('password')}
          />
        ) : null}
        <ListSection>
          <ListRow title={t('network:ddns.ipv6')} switchValue={input.ipv6} onSwitch={(ipv6) => set({ ipv6 })} />
          <ListRow
            title={t('network:ddns.enabled')}
            switchValue={input.enabled}
            onSwitch={(enabled) => set({ enabled })}
          />
        </ListSection>
        {err('ipv6') ? (
          <AppText variant="footnote" tone="danger">
            {err('ipv6')}
          </AppText>
        ) : null}
        <AppText variant="footnote" tone="secondary">
          {t('network:ddns.source')}
        </AppText>
        {input.source === 'other' ? (
          <AppText variant="body">{t('network:ddns.sourceOther')}</AppText>
        ) : (
          <Segmented
            values={[t('network:ddns.sourceWan'), t('network:ddns.sourceWeb')]}
            selectedIndex={SOURCES.indexOf(input.source)}
            onChange={(e) => set({ source: SOURCES[e.nativeEvent.selectedSegmentIndex] })}
          />
        )}
        <AppText variant="footnote" tone="secondary">
          {t('network:ddns.sourceHint')}
        </AppText>
      </EditSheet>
      <SelectSheet
        visible={picking}
        title={t('network:ddns.provider')}
        options={[
          ...providers.map((p) => ({ value: p, label: p })),
          { value: CUSTOM, label: t('network:ddns.custom') },
        ]}
        value={input.provider || CUSTOM}
        onSelect={(value) => {
          set({ provider: value === CUSTOM ? '' : value });
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
});
