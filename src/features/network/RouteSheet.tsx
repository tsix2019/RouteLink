import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NetInterface } from '@/api/services/network';
import { validateStaticRoute, type Family, type StaticRoute, type StaticRouteInput } from '@/api/services/routes';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';

/** Add or edit one static route; the family is fixed when editing. */
export function RouteSheet({
  route,
  family: initialFamily,
  interfaces,
  onSave,
  onCancel,
}: {
  route?: StaticRoute;
  family: Family;
  interfaces: NetInterface[];
  onSave(input: StaticRouteInput): void;
  onCancel(): void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState<StaticRouteInput>({
    family: route?.family ?? initialFamily,
    interface: route?.interface ?? interfaces.find((i) => i.name === 'lan')?.name ?? '',
    target: route?.target ?? '',
    gateway: route?.gateway ?? '',
    metric: route?.metric ?? '',
    table: route?.table ?? '',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateStaticRoute>>({});
  const [picking, setPicking] = useState(false);
  const set = (patch: Partial<StaticRouteInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const errorText = (key: keyof StaticRouteInput) =>
    errors[key] ? t(`network:routes.error.${errors[key]}`) : undefined;

  const submit = () => {
    const found = validateStaticRoute(
      input,
      interfaces.find((i) => i.name === input.interface),
    );
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
              <AppText variant="title">{route ? t('network:routes.edit') : t('network:routes.add')}</AppText>
              {route ? null : (
                <SegmentedControl
                  values={['IPv4', 'IPv6']}
                  selectedIndex={input.family === 4 ? 0 : 1}
                  onChange={(e) => set({ family: e.nativeEvent.selectedSegmentIndex === 0 ? 4 : 6 })}
                />
              )}
              <ListSection>
                <ListRow
                  title={t('network:routes.interface')}
                  value={input.interface || undefined}
                  chevron
                  onPress={() => setPicking(true)}
                  testID="route-interface"
                />
              </ListSection>
              {errorText('interface') ? (
                <AppText variant="footnote" tone="danger">
                  {errorText('interface')}
                </AppText>
              ) : null}
              <TextField
                label={t('network:routes.target')}
                value={input.target}
                onChangeText={(v) => set({ target: v })}
                placeholder={input.family === 4 ? '10.10.0.0/16' : 'fd00:10::/64'}
                hint={t('network:routes.targetHint')}
                autoCapitalize="none"
                autoCorrect={false}
                monospace
                error={errorText('target')}
                testID="route-target"
              />
              <TextField
                label={t('network:routes.gateway')}
                value={input.gateway}
                onChangeText={(v) => set({ gateway: v })}
                placeholder={t('network:routes.optional')}
                hint={t('network:routes.gatewayHint')}
                autoCapitalize="none"
                autoCorrect={false}
                monospace
                error={errorText('gateway')}
                testID="route-gateway"
              />
              <TextField
                label={t('network:routes.metricLabel')}
                value={input.metric}
                onChangeText={(v) => set({ metric: v })}
                placeholder={t('network:routes.optional')}
                keyboardType="number-pad"
                error={errorText('metric')}
              />
              <TextField
                label={t('network:routes.tableLabel')}
                value={input.table}
                onChangeText={(v) => set({ table: v })}
                placeholder="main"
                autoCapitalize="none"
                autoCorrect={false}
                error={errorText('table')}
              />
              <GlassButton label={t('save')} variant="primary" onPress={submit} testID="route-save" />
              <GlassButton label={t('cancel')} onPress={onCancel} />
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
      <SelectSheet
        visible={picking}
        title={t('network:routes.interface')}
        options={interfaces.map((i) => ({ value: i.name, label: i.name, detail: i.device }))}
        value={input.interface}
        onSelect={(v) => {
          set({ interface: v });
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
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
