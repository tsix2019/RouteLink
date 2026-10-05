import { useState } from 'react';

import type { UciSection } from '@/api/uci';
import { validateWgInterface, type WgConfigInterface, type WgInterfaceInput } from '@/api/services/wireguard-config';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EditSheet } from '@/ui/EditSheet';
import { ListRow, ListSection } from '@/ui/ListSection';
import { TextField } from '@/ui/TextField';

/** Create a tunnel (name, port and subnet suggested, key made by the router) or edit one. */
export function WgInterfaceSheet({
  initial,
  editing,
  interfaces,
  network,
  onSave,
  onCancel,
}: {
  initial: WgInterfaceInput;
  /** The tunnel being edited; absent when creating one. */
  editing?: WgConfigInterface;
  interfaces: WgConfigInterface[];
  network: Record<string, UciSection>;
  onSave(input: WgInterfaceInput): void;
  onCancel(): void;
}) {
  const t = useT();
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateWgInterface>>({});
  const set = (patch: Partial<WgInterfaceInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof WgInterfaceInput) => (errors[key] ? t(`network:wireguard.error.${errors[key]!}`) : undefined);

  return (
    <EditSheet
      title={editing ? t('network:wireguard.editTunnel') : t('network:wireguard.newTunnel')}
      onCancel={onCancel}
      onSave={() => {
        const found = validateWgInterface(input, interfaces, network, editing?.name);
        setErrors(found);
        if (!Object.keys(found).length) onSave(input);
      }}
      testID="wg-iface-sheet">
      {editing ? null : (
        <TextField
          label={t('network:wireguard.name')}
          value={input.name}
          onChangeText={(name) => set({ name })}
          autoCapitalize="none"
          autoCorrect={false}
          monospace
          error={err('name')}
        />
      )}
      <TextField
        label={t('network:wireguard.listenPort')}
        value={input.listenPort}
        onChangeText={(listenPort) => set({ listenPort })}
        keyboardType="number-pad"
        monospace
        error={err('listenPort')}
      />
      <TextField
        label={t('network:wireguard.addresses')}
        value={input.addresses}
        onChangeText={(addresses) => set({ addresses })}
        hint={t('network:wireguard.addressesHint')}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        monospace
        error={err('addresses')}
      />
      <TextField
        label={t('network:wireguard.mtu')}
        value={input.mtu}
        onChangeText={(mtu) => set({ mtu })}
        placeholder={t('network:wireguard.mtuHint')}
        keyboardType="number-pad"
        error={err('mtu')}
      />
      <ListSection>
        <ListRow
          title={t('network:wireguard.joinLan')}
          subtitle={t('network:wireguard.joinLanHint')}
          switchValue={input.joinLan}
          onSwitch={(joinLan) => set({ joinLan })}
        />
        <ListRow
          title={t('network:wireguard.openPort')}
          subtitle={t('network:wireguard.openPortHint')}
          switchValue={input.openPort}
          onSwitch={(openPort) => set({ openPort })}
        />
      </ListSection>
      {editing ? null : (
        <AppText variant="footnote" tone="secondary">
          {t('network:wireguard.keysGenerated')}
        </AppText>
      )}
      {errors.privateKey ? (
        <AppText variant="footnote" tone="danger">
          {t(`network:wireguard.error.${errors.privateKey}`)}
        </AppText>
      ) : null}
    </EditSheet>
  );
}
