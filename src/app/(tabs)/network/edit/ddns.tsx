import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

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
import { pickWan } from '@/api/services/network';
import type { UbusCall } from '@/api/ubus/types';
import { useInterfaces, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { isPrivateIPv4 } from '@/utils/net';

const CUSTOM = '__custom__';
const SOURCES: DdnsInput['source'][] = ['wan', 'web'];

/** NW-9: add a DDNS service, or edit `?section=`. Saved directly, then ddns restarts. */
export default function EditDdns() {
  const t = useT();
  const params = useLocalSearchParams<{ section?: string }>();
  const state = useRouterQuery(['ddns'], getDdns);
  const interfaces = useInterfaces();
  const service = useLoaded(
    params.section ? state.data?.services.find((s) => s.section === params.section) : undefined,
  );
  const title = params.section ? t('network:ddns.edit') : t('network:ddns.add');
  if (!state.data || !interfaces.data || (params.section && !service)) {
    return (
      <FormPlaceholder
        title={title}
        error={state.error ?? interfaces.error}
        onRetry={() => void Promise.all([state.refetch(), interfaces.refetch()])}
        missing={!!state.data && !!params.section && !service}
      />
    );
  }
  const wanIp = pickWan(interfaces.data)?.ipv4[0]?.address;
  return (
    <DdnsForm
      title={title}
      service={service}
      providers={state.data.providers}
      sections={state.data.sections}
      behindNat={!!wanIp && isPrivateIPv4(wanIp)}
    />
  );
}

function DdnsForm({
  title,
  service,
  providers,
  sections,
  behindNat,
}: {
  title: string;
  service?: DdnsService;
  providers: string[];
  sections: string[];
  /** The WAN has a private address: a web check finds the real one. */
  behindNat: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState<DdnsInput>(() => ({
    provider: service ? service.provider : (providers.find((p) => p === 'duckdns.org') ?? providers[0] ?? ''),
    updateUrl: service?.updateUrl ?? '',
    domain: service?.domain ?? '',
    username: service?.username ?? '',
    password: service?.password ?? '',
    ipv6: service?.ipv6 ?? false,
    source: service?.source ?? (behindNat ? 'web' : 'wan'),
    enabled: service?.enabled ?? true,
  }));
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateDdns>>({});
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const save = useRouterMutation((conn, changes: UbusCall[]) => saveDdns(conn, changes), [['ddns']]);
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

  const done = {
    onSuccess: () => {
      toast(t('network:ddns.saved'));
      exit.back();
    },
    onError: (e: unknown) => toast(describeError(t, e).title, 'error'),
  };
  const submit = () => {
    const found = validateDdns(input, custom ? null : (needs ?? null));
    setErrors(found);
    if (!Object.keys(found).length) save.mutate(ddnsChanges(input, sections, service), done);
  };

  return (
    <>
      <FormScreen
        title={title}
        dirty={differs(input, initial)}
        leaving={exit.leaving}
        onSave={submit}
        saving={save.isPending}
        onDelete={service ? () => setDeleting(true) : undefined}
        deleteLabel={t('network:ddns.delete')}
        testID="ddns-form">
        <ListSection footer={t('network:ddns.providerHint')}>
          <ListRow
            title={t('network:ddns.provider')}
            value={input.provider || t('network:ddns.custom')}
            chevron
            onPress={() => setPicking(true)}
            testID="ddns-provider"
          />
        </ListSection>
        <GlassCard contentStyle={styles.card}>
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
            testID="ddns-domain"
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
              testID="ddns-password"
            />
          ) : null}
        </GlassCard>
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
        <GlassCard contentStyle={styles.card}>
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
        </GlassCard>
      </FormScreen>

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
      <RiskConfirm
        visible={deleting}
        level="medium"
        title={service ? t('network:ddns.deleteTitle', { name: service.domain || service.section }) : ''}
        consequences={[t('network:ddns.deleteConsequence')]}
        confirmLabel={t('network:ddns.delete')}
        onConfirm={() => {
          setDeleting(false);
          if (service) save.mutate(deleteDdnsChanges(service), done);
        }}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
