import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { NoBlurTarget } from './glass/BlurTarget';
import { GlassSurface } from './glass/GlassSurface';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

/** Blocks the screen while a change that may drop the connection is applied and confirmed. */
export function BusyOverlay({ visible, title, hint }: { visible: boolean; title: string; hint?: string }) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <NoBlurTarget>
        <View style={styles.scrim}>
          <GlassSurface variant="floating" style={styles.card}>
            <ActivityIndicator size="large" color={colors.accent} />
            <AppText variant="title" align="center">
              {title}
            </AppText>
            {hint ? (
              <AppText variant="body" tone="secondary" align="center">
                {hint}
              </AppText>
            ) : null}
          </GlassSurface>
        </View>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { padding: spacing.xl, gap: spacing.m, alignItems: 'center' },
});
