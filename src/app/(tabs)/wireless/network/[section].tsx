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
import { bandLabel, encryptionLabel } from '@/features/wireless/labels';
import { useReconnectDraft } from '@/features/wireless/reconnectDraft';
import { useWirelessActions } from '@/features/wireless/useWirelessActions';
import { useClients, useRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

export default function NetworkScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const radios = useRadios();
  const radio = radios.data?.find((r) => r.networks.some((n) => n.section === section));
  const network = radio?.networks.find((n) => n.section === section);

  if (radio && network) return <NetworkForm network={network} band={radio.band} />;
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

function NetworkForm({ network, band }: { network: WifiNetwork; band: Parameters<typeof bandLabel>[1] }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const actions = useWirelessActions();
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
  const changed = networkChanges(network, patch).length > 0;
  const onThisNetwork = isPhoneOnNetwork(phone.data?.ip, clients.data ?? [], network.ifname);

  const save = () => {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    if (!changed) {
      toast(t('wireless:radio.noChanges'), 'info');
      return;
    }
    setConfirming(true);
  };

  const apply = () => {
    setConfirming(false);
    if (onThisNetwork) {
      // Rollback would need the app to reach the router again, which it can't until the phone rejoins.
      actions.applyNetwork(network, patch, 'direct', () => {
        setReconnect(ssid, needsKey(encryption) ? key : undefined);
        nav.replace('/wireless/reconnect');
      });
    } else {
      actions.applyNetwork(network, patch, 'rollback', () => nav.back());
    }
  };

  const issueText = (issue: (typeof issues)[number]) => t(`wireless:network.issues.${issue}`);
  const ssidIssue = issues.find((i) => i.startsWith('ssid'));
  const keyIssue = issues.find((i) => i.startsWith('key'));

  return (
    <>
      <Screen title={network.ssid || network.section} inTabs>
        <GlassCard title={bandLabel(t, band)} subtitle={network.section} icon="wifi">
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
        <GlassButton
          label={t('wireless:radio.save')}
          variant="primary"
          loading={actions.busy}
          disabled={actions.busy}
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
        consequences={
          onThisNetwork
            ? [t('wireless:network.consequencePhone'), t('wireless:network.consequenceNoRollback')]
            : [t('wireless:network.consequenceRestart'), t('wireless:network.consequenceRollback')]
        }
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
