import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { GlassButton } from './GlassButton';
import { NoBlurTarget } from './glass/BlurTarget';
import { GlassSurface } from './glass/GlassSurface';
import { spacing } from './theme/tokens';

/**
 * The floating glass form used for adding or editing one item: title, fields, then Save and Cancel (and an
 * optional destructive action). Nothing reaches the router until the caller acts on onSave.
 */
export function EditSheet({
  title,
  children,
  onSave,
  onCancel,
  saveLabel,
  saveDisabled,
  busy,
  onDelete,
  deleteLabel,
  testID,
}: {
  title: string;
  children: ReactNode;
  onSave(): void;
  onCancel(): void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Shows a spinner on Save (e.g. while keys are generated). */
  busy?: boolean;
  onDelete?(): void;
  deleteLabel?: string;
  testID?: string;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={testID}>
              <AppText variant="title">{title}</AppText>
              {children}
              <GlassButton
                label={saveLabel ?? t('save')}
                variant="primary"
                disabled={saveDisabled || busy}
                loading={busy}
                onPress={onSave}
                testID={testID ? `${testID}-save` : undefined}
              />
              {onDelete ? (
                <GlassButton label={deleteLabel ?? t('delete')} variant="destructive" icon="trash" onPress={onDelete} />
              ) : null}
              <GlassButton label={t('cancel')} onPress={onCancel} />
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0, maxHeight: '92%' },
  sheet: { padding: spacing.xl },
  content: { gap: spacing.m },
});
