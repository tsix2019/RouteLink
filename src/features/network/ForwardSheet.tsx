import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Client } from '@/api/services/clients';
import {
  forwardConflicts,
  validatePortForward,
  type FirewallZone,
  type PortForward,
  type PortForwardInput,
} from '@/api/services/firewall';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';

const PROTOCOLS: PortForwardInput['protocols'][] = [['tcp'], ['udp'], ['tcp', 'udp']];

/** Add or edit a port forward; the device can be picked from the device list. */
export function ForwardSheet({
  forward,
  forwards,
  zones,
  clients,
  onSave,
  onCancel,
}: {
  forward?: PortForward;
  forwards: PortForward[];
  zones: FirewallZone[];
  clients: Client[];
  onSave(input: PortForwardInput): void;
  onCancel(): void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const wanZone = zones.find((z) => z.masq)?.name ?? 'wan';
  const lanZone = zones.find((z) => z.name === 'lan')?.name ?? zones.find((z) => !z.masq)?.name ?? 'lan';
  const [input, setInput] = useState<PortForwardInput>({
    name: forward?.name ?? '',
    protocols: (forward?.protocols.filter((p) => p === 'tcp' || p === 'udp') as PortForwardInput['protocols']) ?? [
      'tcp',
    ],
    srcZone: forward?.srcZone ?? wanZone,
    externalPort: forward?.externalPort ?? '',
    destZone: forward?.destZone ?? lanZone,
    internalIp: forward?.internalIp ?? '',
    internalPort: forward?.internalPort ?? '',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validatePortForward>>({});
  const [picker, setPicker] = useState<'device' | 'src' | 'dest' | null>(null);
  const set = (patch: Partial<PortForwardInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof PortForwardInput) => (errors[key] ? t(`network:firewall.error.${errors[key]}`) : undefined);
  const conflicts = forwardConflicts(forwards, input, forward?.section);
  const protoIndex = Math.max(
    0,
    PROTOCOLS.findIndex((p) => p.join(' ') === input.protocols.join(' ')),
  );

  const submit = () => {
    const found = validatePortForward(input);
    setErrors(found);
    if (!Object.keys(found).length) onSave(input);
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <AppText variant="title">
                {forward ? t('network:firewall.editForward') : t('network:firewall.addForward')}
              </AppText>
              <TextField
                label={t('network:firewall.name')}
                value={input.name}
                onChangeText={(v) => set({ name: v })}
                placeholder="NAS-HTTPS"
                error={err('name')}
              />
              <SegmentedControl
                values={['TCP', 'UDP', 'TCP + UDP']}
                selectedIndex={protoIndex}
                onChange={(e) => set({ protocols: PROTOCOLS[e.nativeEvent.selectedSegmentIndex] })}
              />
              <TextField
                label={t('network:firewall.externalPort')}
                value={input.externalPort}
                onChangeText={(v) => set({ externalPort: v })}
                placeholder="8443"
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                monospace
                error={
                  err('externalPort') ??
                  (conflicts.length
                    ? t('network:firewall.conflict', {
                        names: conflicts.map((c) => c.name || c.externalPort).join(', '),
                      })
                    : undefined)
                }
                testID="forward-external"
              />
              <ListSection>
                <ListRow
                  title={t('network:firewall.chooseDevice')}
                  icon="devices"
                  chevron
                  onPress={() => setPicker('device')}
                />
              </ListSection>
              <TextField
                label={t('network:firewall.internalIp')}
                value={input.internalIp}
                onChangeText={(v) => set({ internalIp: v })}
                placeholder="192.168.1.100"
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                monospace
                error={err('internalIp')}
                testID="forward-ip"
              />
              <TextField
                label={t('network:firewall.internalPort')}
                value={input.internalPort}
                onChangeText={(v) => set({ internalPort: v })}
                placeholder={t('network:firewall.samePort')}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                monospace
                error={err('internalPort')}
              />
              <ListSection>
                <ListRow
                  title={t('network:firewall.srcZone')}
                  value={input.srcZone}
                  chevron
                  onPress={() => setPicker('src')}
                />
                <ListRow
                  title={t('network:firewall.destZone')}
                  value={input.destZone}
                  chevron
                  onPress={() => setPicker('dest')}
                />
              </ListSection>
              <GlassButton label={t('save')} variant="primary" onPress={submit} testID="forward-save" />
              <GlassButton label={t('cancel')} onPress={onCancel} />
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
      <SelectSheet
        visible={picker === 'device'}
        title={t('network:firewall.chooseDevice')}
        options={clients.filter((c) => c.ipv4).map((c) => ({ value: c.ipv4!, label: c.name, detail: c.ipv4 }))}
        value={input.internalIp}
        onSelect={(ip) => {
          const name = clients.find((c) => c.ipv4 === ip)?.name;
          set({ internalIp: ip, name: input.name || name || '' });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'src' || picker === 'dest'}
        title={picker === 'src' ? t('network:firewall.srcZone') : t('network:firewall.destZone')}
        options={zones.map((z) => ({ value: z.name, label: z.name, detail: z.networks.join(', ') }))}
        value={picker === 'src' ? input.srcZone : input.destZone}
        onSelect={(zone) => {
          set(picker === 'src' ? { srcZone: zone } : { destZone: zone });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0, maxHeight: '90%' },
  sheet: { padding: spacing.xl },
  content: { gap: spacing.m },
});
