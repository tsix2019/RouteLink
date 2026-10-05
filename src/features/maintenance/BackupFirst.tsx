import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backupFileName, downloadBackup } from '@/api/services/backup';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useSystem } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

import { saveLocalBackup } from './files';

/** Design §10: before flashing, restoring or resetting, offer to save the current configuration on the phone. */
export function BackupFirst({
  visible,
  onContinue,
  onCancel,
}: {
  visible: boolean;
  onContinue(): void;
  onCancel(): void;
}) {
  const t = useT();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { connection } = useActiveRouter();
  const hostname = useSystem().data?.hostname ?? 'OpenWrt';
  const [busy, setBusy] = useState(false);
  if (!visible) return null;

  const backup = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      const saved = saveLocalBackup(backupFileName(hostname, new Date()), await downloadBackup(connection));
      toast(t('more:backupScreen.saved', { name: saved.name }));
      onContinue();
    } catch (e) {
      toast(describeError(t, e).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={busy ? undefined : onCancel} accessibilityLabel={t('cancel')} />
        <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.m }]}>
          <GlassSurface variant="floating" style={styles.sheet}>
            <View style={styles.titleRow}>
              <Icon name="backup" size={22} color={colors.accent} />
              <AppText variant="title" style={styles.flex}>
                {t('more:backupFirst.title')}
              </AppText>
            </View>
            <AppText variant="body" tone="secondary">
              {t('more:backupFirst.message')}
            </AppText>
            <GlassButton
              label={t('more:backupFirst.backup')}
              variant="primary"
              loading={busy}
              disabled={busy}
              onPress={() => void backup()}
              testID="backup-first"
            />
            <GlassButton label={t('more:backupFirst.skip')} disabled={busy} onPress={onContinue} />
            <GlassButton label={t('cancel')} disabled={busy} onPress={onCancel} />
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  flex: { flex: 1 },
});
