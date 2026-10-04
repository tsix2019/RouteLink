import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { GlassButton } from './GlassButton';
import { GlassSurface } from './glass/GlassSurface';
import { Icon } from './Icon';
import { TextField } from './TextField';
import { useTheme } from './theme/ThemeProvider';
import { Toggle } from './Toggle';
import { spacing } from './theme/tokens';
import { NoBlurTarget } from './glass/BlurTarget';

export interface RiskConfirmProps {
  visible: boolean;
  /** medium: confirmation sheet. high: full-screen warning that needs a checkbox and a typed phrase. */
  level: 'medium' | 'high';
  title: string;
  consequences: string[];
  confirmLabel: string;
  /** Use the warning colour for changes that may drop the connection. */
  disruptive?: boolean;
  /** high only: the user must type this exactly (the router name). */
  confirmPhrase?: string;
  /** medium only: one extra switch, e.g. "block reconnecting for 5 minutes". */
  option?: { label: string; value: boolean; onChange(value: boolean): void };
  onConfirm(): void;
  onCancel(): void;
}

export function RiskConfirm(props: RiskConfirmProps) {
  if (!props.visible) return null;
  return props.level === 'high' ? <HighRisk {...props} /> : <MediumRisk {...props} />;
}

function MediumRisk({ title, consequences, confirmLabel, disruptive, option, onConfirm, onCancel }: RiskConfirmProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.m }]}>
          <GlassSurface variant="floating" style={styles.sheet}>
            <View style={styles.titleRow}>
              <Icon name="warning" size={22} color={disruptive ? colors.warning : colors.accent} />
              <AppText variant="title" style={styles.flex}>
                {title}
              </AppText>
            </View>
            {consequences.map((c) => (
              <View key={c} style={styles.bullet}>
                <AppText variant="body" tone="secondary">
                  •
                </AppText>
                <AppText variant="body" tone="secondary" style={styles.flex}>
                  {c}
                </AppText>
              </View>
            ))}
            {option ? (
              <View style={styles.optionRow}>
                <AppText variant="body" style={styles.flex}>
                  {option.label}
                </AppText>
                <Toggle value={option.value} onValueChange={option.onChange} accessibilityLabel={option.label} />
              </View>
            ) : null}
            <GlassButton label={confirmLabel} variant={disruptive ? 'warning' : 'primary'} onPress={onConfirm} />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

function HighRisk({ title, consequences, confirmLabel, confirmPhrase = '', onConfirm, onCancel }: RiskConfirmProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [checked, setChecked] = useState(false);
  const [phrase, setPhrase] = useState('');
  const ready = checked && phrase === confirmPhrase;

  return (
    <Modal animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <NoBlurTarget>
        <KeyboardAvoidingView
          behavior="padding"
          style={[styles.full, { backgroundColor: colors.background, paddingTop: insets.top + spacing.l }]}>
          <ScrollView contentContainerStyle={styles.fullContent} keyboardShouldPersistTaps="handled">
            <View style={[styles.hazard, { backgroundColor: colors.danger }]}>
              <Icon name="error" size={36} color={colors.accentText} />
            </View>
            <AppText variant="largeTitle" align="center">
              {title}
            </AppText>
            <AppText variant="headline" tone="danger" align="center">
              {t('risk:highTitle')}
            </AppText>
            <GlassSurface style={styles.risks}>
              {consequences.map((c) => (
                <View key={c} style={styles.bullet}>
                  <Icon name="warning" size={16} color={colors.danger} />
                  <AppText variant="body" style={styles.flex}>
                    {c}
                  </AppText>
                </View>
              ))}
            </GlassSurface>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => setChecked((v) => !v)}
              style={styles.checkRow}>
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: checked ? colors.danger : colors.textTertiary,
                    backgroundColor: checked ? colors.danger : 'transparent',
                  },
                ]}>
                {checked ? <Icon name="check" size={16} color={colors.accentText} /> : null}
              </View>
              <AppText variant="body" style={styles.flex}>
                {t('risk:understand')}
              </AppText>
            </Pressable>
            <TextField
              testID="risk-confirm-phrase"
              label={t('risk:typeToConfirm', { phrase: confirmPhrase })}
              value={phrase}
              onChangeText={setPhrase}
              placeholder={confirmPhrase}
            />
          </ScrollView>
          <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.l }]}>
            <GlassButton label={confirmLabel} variant="destructive" disabled={!ready} onPress={onConfirm} />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </View>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s },
  full: { flex: 1, paddingHorizontal: spacing.l },
  fullContent: { gap: spacing.l, alignItems: 'stretch' },
  hazard: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  risks: { padding: spacing.l, gap: spacing.m },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: spacing.s },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing.s, paddingTop: spacing.m },
});
