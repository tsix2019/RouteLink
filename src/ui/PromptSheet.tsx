import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { GlassButton } from './GlassButton';
import { GlassSurface } from './glass/GlassSurface';
import { TextField, type TextFieldProps } from './TextField';
import { spacing } from './theme/tokens';
import { NoBlurTarget } from './glass/BlurTarget';

export interface PromptSheetProps {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  hint?: string;
  confirmLabel: string;
  /** Return an error message to keep the sheet open, or nothing to close it. */
  validate?: (value: string) => string | undefined;
  onSubmit(value: string): void;
  onCancel(): void;
  inputProps?: Partial<TextFieldProps>;
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). */
export function PromptSheet(props: PromptSheetProps) {
  if (!props.visible) return null;
  return <PromptContent {...props} />;
}

function PromptContent({
  title,
  initialValue = '',
  placeholder,
  hint,
  confirmLabel,
  validate,
  onSubmit,
  onCancel,
  inputProps,
}: PromptSheetProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    const problem = validate?.(value);
    if (problem) setError(problem);
    else onSubmit(value);
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        {/* KeyboardAvoidingView owns paddingBottom, so the safe-area inset goes on an inner view. */}
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <AppText variant="title">{title}</AppText>
            <TextField
              value={value}
              onChangeText={(v) => {
                setValue(v);
                setError(undefined);
              }}
              placeholder={placeholder}
              error={error}
              hint={hint}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              testID="prompt-input"
              {...inputProps}
            />
            <GlassButton label={confirmLabel} variant="primary" onPress={submit} />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
});
