import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  validateTrafficRule,
  type FirewallZone,
  type TrafficRule,
  type TrafficRuleInput,
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
import { Segmented } from '@/ui/Segmented';

const PROTOCOLS = ['tcp udp', 'tcp', 'udp', 'icmp', 'all'] as const;
const TARGETS: TrafficRuleInput['target'][] = ['ACCEPT', 'REJECT', 'DROP'];
const FAMILIES: TrafficRuleInput['family'][] = ['', 'ipv4', 'ipv6'];
/** "" is the router itself, "*" any zone. */
const ROUTER = '';

/** Add or edit a traffic rule; options the form doesn't cover stay as they are. */
export function RuleSheet({
  rule,
  zones,
  onSave,
  onCancel,
}: {
  rule?: TrafficRule;
  zones: FirewallZone[];
  onSave(input: TrafficRuleInput): void;
  onCancel(): void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState<TrafficRuleInput>({
    name: rule?.name ?? '',
    src: rule ? (rule.src ?? ROUTER) : (zones.find((z) => z.masq)?.name ?? 'wan'),
    dest: rule ? (rule.dest ?? ROUTER) : ROUTER,
    protocols: rule?.protocols ?? ['tcp', 'udp'],
    srcIp: rule?.srcIp.join(' ') ?? '',
    destIp: rule?.destIp.join(' ') ?? '',
    destPort: rule?.destPort ?? '',
    target: (TARGETS.includes(rule?.target as TrafficRuleInput['target'])
      ? rule?.target
      : 'ACCEPT') as TrafficRuleInput['target'],
    family: (FAMILIES.includes((rule?.family ?? '') as TrafficRuleInput['family'])
      ? (rule?.family ?? '')
      : '') as TrafficRuleInput['family'],
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateTrafficRule>>({});
  const [picker, setPicker] = useState<'src' | 'dest' | 'proto' | null>(null);
  const set = (patch: Partial<TrafficRuleInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof TrafficRuleInput) => (errors[key] ? t(`network:firewall.error.${errors[key]}`) : undefined);
  const zoneLabel = (z: string) =>
    z === ROUTER ? t('network:firewall.thisRouter') : z === '*' ? t('network:firewall.anyZone') : z;
  const zoneOptions = [
    { value: ROUTER, label: t('network:firewall.thisRouter') },
    { value: '*', label: t('network:firewall.anyZone') },
    ...zones.map((z) => ({ value: z.name, label: z.name, detail: z.networks.join(', ') })),
  ];
  const proto = input.protocols.join(' ');

  const submit = () => {
    const found = validateTrafficRule(input);
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
              <AppText variant="title">{rule ? t('network:firewall.editRule') : t('network:firewall.addRule')}</AppText>
              {rule?.extra.length ? (
                <AppText variant="footnote" tone="secondary">
                  {t('network:firewall.advancedHint', { options: rule.extra.join(', ') })}
                </AppText>
              ) : null}
              <TextField
                label={t('network:firewall.name')}
                value={input.name}
                onChangeText={(v) => set({ name: v })}
                placeholder="Allow-SSH"
                error={err('name')}
              />
              <ListSection>
                <ListRow
                  title={t('network:firewall.source')}
                  value={zoneLabel(input.src)}
                  chevron
                  onPress={() => setPicker('src')}
                />
                <ListRow
                  title={t('network:firewall.destination')}
                  value={zoneLabel(input.dest)}
                  chevron
                  onPress={() => setPicker('dest')}
                />
                <ListRow
                  title={t('network:firewall.protocol')}
                  value={
                    (PROTOCOLS as readonly string[]).includes(proto)
                      ? t(`network:firewall.proto.${proto as 'tcp'}`)
                      : proto
                  }
                  chevron
                  onPress={() => setPicker('proto')}
                />
              </ListSection>
              {err('dest') || err('protocols') ? (
                <AppText variant="footnote" tone="danger">
                  {err('dest') ?? err('protocols')}
                </AppText>
              ) : null}
              <TextField
                label={t('network:firewall.destPort')}
                value={input.destPort}
                onChangeText={(v) => set({ destPort: v })}
                placeholder="22 80 8000-8100"
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                monospace
                error={err('destPort')}
              />
              <TextField
                label={t('network:firewall.srcIp')}
                value={input.srcIp}
                onChangeText={(v) => set({ srcIp: v })}
                placeholder={t('network:firewall.anyAddress')}
                autoCapitalize="none"
                autoCorrect={false}
                monospace
                error={err('srcIp')}
              />
              <TextField
                label={t('network:firewall.destIp')}
                value={input.destIp}
                onChangeText={(v) => set({ destIp: v })}
                placeholder={t('network:firewall.anyAddress')}
                autoCapitalize="none"
                autoCorrect={false}
                monospace
                error={err('destIp')}
              />
              <AppText variant="footnote" tone="secondary">
                {t('network:firewall.action')}
              </AppText>
              <Segmented
                values={TARGETS.map((x) => t(`network:firewall.target.${x}`))}
                selectedIndex={TARGETS.indexOf(input.target)}
                onChange={(e) => set({ target: TARGETS[e.nativeEvent.selectedSegmentIndex] })}
              />
              <AppText variant="footnote" tone="secondary">
                {t('network:firewall.family')}
              </AppText>
              <Segmented
                values={[t('network:firewall.familyBoth'), 'IPv4', 'IPv6']}
                selectedIndex={FAMILIES.indexOf(input.family)}
                onChange={(e) => set({ family: FAMILIES[e.nativeEvent.selectedSegmentIndex] })}
              />
              <GlassButton label={t('save')} variant="primary" onPress={submit} testID="rule-save" />
              <GlassButton label={t('cancel')} onPress={onCancel} />
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
      <SelectSheet
        visible={picker === 'src' || picker === 'dest'}
        title={picker === 'src' ? t('network:firewall.source') : t('network:firewall.destination')}
        options={zoneOptions}
        value={picker === 'src' ? input.src : input.dest}
        onSelect={(zone) => {
          set(picker === 'src' ? { src: zone } : { dest: zone });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'proto'}
        title={t('network:firewall.protocol')}
        options={PROTOCOLS.map((p) => ({ value: p, label: t(`network:firewall.proto.${p}`) }))}
        value={proto}
        onSelect={(p) => {
          set({ protocols: p.split(' ') });
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
