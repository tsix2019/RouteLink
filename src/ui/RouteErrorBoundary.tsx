import type { ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';

import { EmptyState } from './Feedback';
import { useTheme } from './theme/ThemeProvider';

/**
 * Exported as `ErrorBoundary` from layouts (expo-router): a render error shows this instead of a
 * blank screen, with a retry. Works above the providers too (theme and i18n have usable defaults).
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <EmptyState
        icon="error"
        title={t('errors:boundary.title')}
        message={`${t('errors:boundary.message')}\n\n${error.message}`}
        action={{ label: t('errors:boundary.retry'), onPress: () => void retry() }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingTop: 64 },
});
