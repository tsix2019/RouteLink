import { useState } from 'react';

import {
  validatePeer,
  type WgConfigInterface,
  type WgConfigPeer,
  type WgPeerInput,
} from '@/api/services/wireguard-config';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EditSheet } from '@/ui/EditSheet';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';

/**
 * Add or edit a peer. New peers get router-made keys by default (exportable); "Peer's public key" takes a key
 * from a device that made its own. Keys and a preshared key are made before the sheet opens.
 */
export function WgPeerSheet({
  iface,
  initial,
  pskCandidate,
  editing,
  onSave,
  onDelete,
  onCancel,
}: {
  iface: WgConfigInterface;
  initial: WgPeerInput;
  /** A fresh preshared key to use when the switch goes on. */
  pskCandidate?: string;
  editing?: WgConfigPeer;
  onSave(input: WgPeerInput): void;
  onDelete?(): void;
  onCancel(): void;
}) {
  const t = useT();
  const [input, setInput] = useState(initial);
  const [own, setOwn] = useState(!initial.privateKey);
  const [advanced, setAdvanced] = useState(!!(initial.endpointHost || initial.routeAllowedIps));
  const [errors, setErrors] = useState<ReturnType<typeof validatePeer>>({});
  const set = (patch: Partial<WgPeerInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof WgPeerInput) => (errors[key] ? t(`network:wireguard.error.${errors[key]!}`) : undefined);
  const psk = initial.presharedKey || pskCandidate || '';
  const chooseOwnKey = (value: boolean) => {
    setOwn(value);
    set(value ? { privateKey: '', publicKey: '' } : { privateKey: initial.privateKey, publicKey: initial.publicKey });
  };

  return (
    <EditSheet
      title={editing ? t('network:wireguard.editPeer') : t('network:wireguard.addPeer')}
      onCancel={onCancel}
      onDelete={onDelete}
      deleteLabel={t('network:wireguard.deletePeer')}
      onSave={() => {
        const found = validatePeer(input, iface, editing?.section);
        setErrors(found);
        if (!Object.keys(found).length) onSave(input);
      }}
      testID="wg-peer-sheet">
      <TextField
        label={t('network:wireguard.peerName')}
        value={input.name}
        onChangeText={(name) => set({ name })}
        placeholder={t('network:wireguard.peerNamePlaceholder')}
        error={err('name')}
      />
      {initial.privateKey ? (
        <Segmented
          values={[t('network:wireguard.keyGenerated'), t('network:wireguard.keyOwn')]}
          selectedIndex={own ? 1 : 0}
          onChange={(e) => chooseOwnKey(e.nativeEvent.selectedSegmentIndex === 1)}
        />
      ) : null}
      {own ? (
        <TextField
          label={t('network:wireguard.publicKeyField')}
          value={input.publicKey}
          onChangeText={(publicKey) => set({ publicKey: publicKey.trim() })}
          hint={t('network:wireguard.ownKeyHint')}
          autoCapitalize="none"
          autoCorrect={false}
          monospace
          error={err('publicKey')}
          testID="wg-peer-key"
        />
      ) : (
        <AppText variant="footnote" tone="secondary">
          {t('network:wireguard.generatedKeyHint')}
        </AppText>
      )}
      <TextField
        label={t('network:wireguard.allowedIps')}
        value={input.allowedIps}
        onChangeText={(allowedIps) => set({ allowedIps })}
        hint={t('network:wireguard.allowedIpsHint')}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        monospace
        error={err('allowedIps')}
      />
      <TextField
        label={t('network:wireguard.keepalive')}
        value={input.keepalive}
        onChangeText={(keepalive) => set({ keepalive })}
        keyboardType="number-pad"
        error={err('keepalive')}
      />
      <ListSection>
        <ListRow
          title={t('network:wireguard.psk')}
          switchValue={!!input.presharedKey}
          onSwitch={(on) => set({ presharedKey: on ? psk : '' })}
          disabled={!psk}
        />
        <ListRow title={t('network:wireguard.advanced')} switchValue={advanced} onSwitch={setAdvanced} />
      </ListSection>
      {advanced ? (
        <>
          <TextField
            label={t('network:wireguard.endpointHost')}
            value={input.endpointHost}
            onChangeText={(endpointHost) => set({ endpointHost })}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
          />
          <TextField
            label={t('network:wireguard.endpointPort')}
            value={input.endpointPort}
            onChangeText={(endpointPort) => set({ endpointPort })}
            keyboardType="number-pad"
            error={err('endpointPort')}
          />
          <ListSection>
            <ListRow
              title={t('network:wireguard.routeAllowedIps')}
              switchValue={input.routeAllowedIps}
              onSwitch={(routeAllowedIps) => set({ routeAllowedIps })}
            />
          </ListSection>
        </>
      ) : null}
    </EditSheet>
  );
}
