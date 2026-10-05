import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import RouteLinkNative from 'routelink-native';

import {
  macFilterChanges,
  parseMacFilters,
  validateMacFilter,
  type MacFilter,
  type MacFilterMode,
} from '@/api/services/macfilter';
import { isPhoneOnNetwork } from '@/api/services/wireless';
import { stageAndApply, uci, type ApplyOutcome } from '@/api/uci';
import { useClients, useRadios, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { PromptSheet } from '@/ui/PromptSheet';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { Badge } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { normalizeMac } from '@/utils/mac';

const MODES: MacFilterMode[] = ['disable', 'allow', 'deny'];

/** WL-6: hostapd's MAC filter for one access point. */
export default function MacFilterScreen() {
  const t = useT();
  const { section } = useLocalSearchParams<{ section: string }>();
  const filters = useRouterQuery(['macfilter'], async (conn) => parseMacFilters(await uci.get(conn, 'wireless')));
  const filter = filters.data?.find((f) => f.section === section);
  return filter ? (
    <Editor key={filter.section} filter={filter} />
  ) : (
    <Screen title={t('wireless:macfilter.title')} inTabs>
      {filters.isError ? (
        <ErrorState error={filters.error} onRetry={() => void filters.refetch()} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={52} radius={14} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function Editor({ filter }: { filter: MacFilter }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const clients = useClients();
  const radios = useRadios();
  const phone = useQuery({
    queryKey: ['phone-network'],
    queryFn: () => RouteLinkNative.getNetworkInfo(),
    staleTime: 0,
  });
  const [mode, setMode] = useState<MacFilterMode>(filter.mode);
  const [macs, setMacs] = useState<string[]>(filter.macs);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const ifname = radios.data?.flatMap((r) => r.networks).find((n) => n.section === filter.section)?.ifname;
  const onThisNetwork = isPhoneOnNetwork(phone.data?.ip, clients.data ?? [], ifname);
  const phoneMac = onThisNetwork ? clients.data?.find((c) => c.ipv4 === phone.data?.ip)?.mac : undefined;
  const nameOf = (mac: string) => clients.data?.find((c) => c.mac === mac)?.name;
  const problem = validateMacFilter(mode, macs, { phoneMac });

  const apply = useRouterMutation(
    (conn) =>
      stageAndApply(conn, macFilterChanges(filter, mode, macs), { mode: onThisNetwork ? 'direct' : 'rollback' }),
    [['macfilter'], ['radios']],
  );
  const report = (outcome: ApplyOutcome) => {
    toast(outcome.status === 'rolled-back' ? t('wireless:result.rolledBack') : t('wireless:result.applied'));
    if (outcome.status !== 'rolled-back') nav.back();
  };
  const add = (mac: string) => setMacs((list) => (list.includes(mac) ? list : [...list, mac]));

  return (
    <>
      <Screen title={`${t('wireless:macfilter.title')} · ${filter.ssid}`} inTabs>
        <Segmented
          values={MODES.map((m) => t(`wireless:macfilter.modes.${m}`))}
          selectedIndex={MODES.indexOf(mode)}
          onChange={(e) => setMode(MODES[e.nativeEvent.selectedSegmentIndex])}
        />
        <AppText variant="footnote" tone="secondary" style={styles.note}>
          {t(`wireless:macfilter.modeHint.${mode}`)}
        </AppText>
        {mode !== 'disable' ? (
          <>
            <ListSection title={t('wireless:macfilter.list')} footer={t('wireless:macfilter.randomHint')}>
              {macs.length ? (
                macs.map((mac) => (
                  <ListRow
                    key={mac}
                    title={nameOf(mac) ?? mac}
                    subtitle={nameOf(mac) ? mac : undefined}
                    right={
                      mac === phoneMac ? <Badge label={t('wireless:macfilter.thisPhone')} tone="accent" /> : undefined
                    }
                    onPress={() => setSelected(mac)}
                  />
                ))
              ) : (
                <ListRow title={t('wireless:macfilter.empty')} disabled />
              )}
            </ListSection>
            <View style={styles.buttons}>
              <GlassButton label={t('wireless:macfilter.addDevice')} icon="devices" onPress={() => setPicking(true)} />
              <GlassButton label={t('wireless:macfilter.addMac')} icon="plus" onPress={() => setTyping(true)} />
            </View>
          </>
        ) : null}
        {problem ? (
          <AppText variant="footnote" tone="danger" style={styles.note}>
            {t(`wireless:macfilter.error.${problem}`)}
          </AppText>
        ) : null}
        <GlassButton
          label={t('wireless:macfilter.save')}
          variant="primary"
          disabled={!!problem || apply.isPending}
          onPress={() => setConfirming(true)}
          testID="macfilter-save"
        />
      </Screen>

      <SelectSheet
        visible={picking}
        title={t('wireless:macfilter.addDevice')}
        options={(clients.data ?? [])
          .filter((c) => !macs.includes(c.mac))
          .map((c) => ({ value: c.mac, label: c.name, detail: c.mac }))}
        value=""
        onSelect={(mac) => {
          add(mac);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      <PromptSheet
        visible={typing}
        title={t('wireless:macfilter.addMac')}
        placeholder="AA:BB:CC:DD:EE:FF"
        confirmLabel={t('add')}
        validate={(v) => (normalizeMac(v) ? undefined : t('wireless:macfilter.macInvalid'))}
        onSubmit={(v) => {
          add(normalizeMac(v)!);
          setTyping(false);
        }}
        onCancel={() => setTyping(false)}
        inputProps={{ autoCapitalize: 'characters', autoCorrect: false, monospace: true }}
      />
      <ActionSheet
        visible={!!selected}
        title={selected ? (nameOf(selected) ?? selected) : undefined}
        actions={[
          {
            label: t('wireless:macfilter.remove'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              setMacs((list) => list.filter((m) => m !== selected));
              setSelected(null);
            },
          },
        ]}
        onCancel={() => setSelected(null)}
      />
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('wireless:macfilter.confirmTitle', { ssid: filter.ssid })}
        consequences={[
          t('wireless:macfilter.consequence'),
          ...(onThisNetwork ? [t('wireless:macfilter.phoneConsequence')] : []),
        ]}
        confirmLabel={t('wireless:macfilter.save')}
        onConfirm={() => {
          setConfirming(false);
          apply.mutate(undefined, { onSuccess: report, onError: (e) => toast(describeError(t, e).title, 'error') });
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
  buttons: { flexDirection: 'row', gap: spacing.s, flexWrap: 'wrap' },
});
