import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import RouteLinkNative from 'routelink-native';

import {
  ENCRYPTIONS,
  isPhoneOnNetwork,
  needsKey,
  networkChanges,
  validateNetwork,
  type WifiNetwork,
} from '@/api/services/wireless';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { bandLabel, encryptionLabel } from '@/features/wireless/labels';
import { useReconnectDraft } from '@/features/wireless/reconnectDraft';
import { ssidTwins, syncFields, syncPlan, twinsToChange } from '@/features/wireless/ssidSync';
import { useGroupApply } from '@/features/wireless/useGroupApply';
import { useWirelessActions } from '@/features/wireless/useWirelessActions';
import { useClients, useGroupRadios, useRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { HeaderButton, Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

export default function NetworkScreen() {
  // `router`: a router of the active network group (an AP); default is the active router.
  const { section, router } = useLocalSearchParams<{ section: string; router?: string }>();
  const radios = useRadios(router);
  const radio = radios.data?.find((r) => r.networks.some((n) => n.section === section));
  const network = radio?.networks.find((n) => n.section === section);

  if (radio && network) return <NetworkForm network={network} band={radio.band} routerId={router} />;
  return (
    <Screen title={section} inTabs>
      {radios.isError ? (
        <ErrorState error={radios.error} onRetry={() => void radios.refetch()} />
      ) : (
        <View style={styles.loading}>
          <Skeleton height={160} radius={22} />
          <Skeleton height={52} radius={14} />
        </View>
      )}
    </Screen>
  );
}

function NetworkForm({
  network,
  band,
  routerId,
}: {
  network: WifiNetwork;
  band: Parameters<typeof bandLabel>[1];
  routerId?: string;
}) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const { router: active, group } = useActiveRouter();
  const owner = routerId || active?.id || 'none';
  const actions = useWirelessActions(routerId);
  const groupApply = useGroupApply();
  const groupRadios = useGroupRadios();
  const clients = useClients();
  const setReconnect = useReconnectDraft((s) => s.set);
  // The phone's own address decides whether this change will cut the app off (design §11).
  const phone = useQuery({
    queryKey: ['phone-network'],
    queryFn: () => RouteLinkNative.getNetworkInfo(),
    staleTime: 0,
  });

  const [ssid, setSsid] = useState(network.ssid);
  const [encryption, setEncryption] = useState(network.encryption);
  const [key, setKey] = useState(network.key ?? '');
  const [hidden, setHidden] = useState(network.hidden);
  const [enabled, setEnabled] = useState(!network.disabled);
  const [sync, setSync] = useState(true);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const patch = {
    ssid,
    encryption,
    key: needsKey(encryption) ? key : undefined,
    hidden,
    disabled: !enabled,
  };
  const issues = validateNetwork({ ssid, encryption, key });
  const changes = networkChanges(network, patch);
  const phoneOn = (router: string, ifname?: string) =>
    isPhoneOnNetwork(phone.data?.ip, clients.data ?? [], ifname, group.gateway ? router : undefined);
  const onThisNetwork = phoneOn(owner, network.ifname);

  // NG-4: name, security and password changes are offered to the group's other networks of the same name.
  const fields = syncFields({ ssid, encryption, key });
  const roamingChanged = networkChanges(network, fields).length > 0;
  const twins = roamingChanged
    ? twinsToChange(ssidTwins(groupRadios, network.ssid, { routerId: owner, section: network.section }), fields)
    : [];
  const syncing = sync && twins.length > 0;
  const plan = syncing ? syncPlan({ routerId: owner, network, changes }, twins, fields, phoneOn) : [];
  const phoneDrops = syncing ? plan.some((s) => s.mode === 'direct') : onThisNetwork;
  const routerName = (id: string) => groupRadios.find((g) => g.routerId === id)?.name ?? id;

  const save = () => {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    if (!changes.length) {
      toast(t('wireless:radio.noChanges'), 'info');
      return;
    }
    setConfirming(true);
  };

  const rejoin = () => {
    setReconnect(ssid, needsKey(encryption) ? key : undefined);
    nav.replace('/wireless/reconnect');
  };

  const applySynced = async () => {
    const results = await groupApply.run(plan);
    const failed = results.filter((r) => r.status !== 'done' || r.outcome.status === 'rolled-back');
    if (failed.length) {
      toast(
        t('wireless:sync.partial', {
          count: failed.length,
          names: failed.map((r) => routerName(r.routerId)).join('、'),
        }),
        'warning',
      );
    } else {
      toast(t('wireless:sync.done', { count: plan.length }));
    }
    if (phoneDrops) rejoin();
    else nav.back();
  };

  const apply = () => {
    setConfirming(false);
    if (syncing) {
      void applySynced();
    } else if (onThisNetwork) {
      // Rollback would need the app to reach the router again, which it can't until the phone rejoins.
      actions.applyNetwork(network, patch, 'direct', rejoin);
    } else {
      actions.applyNetwork(network, patch, 'rollback', () => nav.back());
    }
  };

  const issueText = (issue: (typeof issues)[number]) => t(`wireless:network.issues.${issue}`);
  const ssidIssue = issues.find((i) => i.startsWith('ssid'));
  const keyIssue = issues.find((i) => i.startsWith('key'));
  const busy = actions.busy || groupApply.busy;
  const routerQuery = routerId ? `&router=${encodeURIComponent(routerId)}` : '';

  return (
    <>
      <Screen
        title={network.ssid || network.section}
        inTabs
        headerRight={
          network.mode === 'ap' ? (
            <HeaderButton
              icon="qrcode"
              accessibilityLabel={t('wireless:qr.title')}
              onPress={() => nav.push(`/wifi-qr?section=${encodeURIComponent(network.section)}${routerQuery}`)}
              testID="network-share"
            />
          ) : undefined
        }>
        <GlassCard
          title={bandLabel(t, band)}
          subtitle={routerId ? `${routerName(routerId)} · ${network.section}` : network.section}
          icon="wifi">
          <TextField
            label={t('wireless:network.ssid')}
            value={ssid}
            onChangeText={setSsid}
            autoCapitalize="none"
            autoCorrect={false}
            error={showIssues && ssidIssue ? issueText(ssidIssue) : undefined}
            testID="wifi-ssid"
          />
        </GlassCard>
        <ListSection>
          <ListRow
            title={t('wireless:network.encryption')}
            value={encryptionLabel(t, encryption)}
            chevron
            onPress={() => setPicking(true)}
            testID="wifi-encryption"
          />
        </ListSection>
        {needsKey(encryption) ? (
          <GlassCard>
            <TextField
              label={t('wireless:network.password')}
              value={key}
              onChangeText={setKey}
              secret
              autoCapitalize="none"
              autoCorrect={false}
              error={showIssues && keyIssue ? issueText(keyIssue) : undefined}
              testID="wifi-key"
            />
          </GlassCard>
        ) : null}
        <ListSection footer={t('wireless:network.hiddenHint')}>
          <ListRow title={t('wireless:network.enabled')} icon="power" switchValue={enabled} onSwitch={setEnabled} />
          <ListRow title={t('wireless:network.hidden')} icon="eyeOff" switchValue={hidden} onSwitch={setHidden} />
        </ListSection>
        {twins.length ? (
          <ListSection footer={t('wireless:sync.hint')}>
            <ListRow
              title={t('wireless:sync.title', { count: twins.length })}
              subtitle={twins.map((tw) => `${tw.routerName} · ${bandLabel(t, tw.band)}`).join('\n')}
              icon="sync"
              switchValue={sync}
              onSwitch={setSync}
              testID="wifi-sync"
            />
          </ListSection>
        ) : null}
        {network.mode === 'ap' && !routerId ? (
          <ListSection>
            <ListRow
              title={t('wireless:macfilter.row')}
              icon="filter"
              chevron
              onPress={() => nav.push(`/wireless/macfilter/${encodeURIComponent(network.section)}`)}
              testID="wifi-macfilter"
            />
          </ListSection>
        ) : null}
        <GlassButton
          label={t('wireless:radio.save')}
          variant="primary"
          loading={busy}
          disabled={busy}
          onPress={save}
          testID="wifi-save"
        />
      </Screen>

      <SelectSheet
        visible={picking}
        title={t('wireless:network.encryption')}
        options={[
          ...ENCRYPTIONS.map((e) => ({ value: e as string, label: encryptionLabel(t, e) })),
          ...((ENCRYPTIONS as string[]).includes(network.encryption)
            ? []
            : [{ value: network.encryption, label: encryptionLabel(t, network.encryption) }]),
        ]}
        value={encryption}
        onSelect={(v) => {
          setEncryption(v);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      <RiskConfirm
        visible={confirming}
        level="medium"
        disruptive
        title={t('wireless:network.confirmTitle')}
        consequences={[
          ...(syncing ? [t('wireless:sync.consequence', { count: plan.length })] : []),
          ...(phoneDrops
            ? [t('wireless:network.consequencePhone'), t('wireless:network.consequenceNoRollback')]
            : [t('wireless:network.consequenceRestart'), t('wireless:network.consequenceRollback')]),
        ]}
        confirmLabel={t('common:confirm')}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
});
