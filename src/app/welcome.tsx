import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { spacing } from '@/ui/theme/tokens';

export default function Welcome() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setSettings = useSettings((s) => s.set);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.hero}>
        <Image source={require('@/assets/images/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
        <AppText variant="largeTitle" align="center">
          RouteLink
        </AppText>
        <AppText variant="headline" tone="secondary" align="center">
          {t('onboarding:tagline')}
        </AppText>
      </View>
      <GlassSurface variant="floating" style={styles.card}>
        <GlassButton label={t('onboarding:addRouter')} icon="plus" variant="primary" onPress={() => router.push('/add-router')} testID="welcome-add" />
        <GlassButton
          label={t('onboarding:tryDemo')}
          icon="demo"
          onPress={() => {
            setSettings({ demoMode: true });
            router.replace('/overview');
          }}
          testID="welcome-demo"
        />
        <AppText variant="footnote" tone="tertiary" align="center">
          {t('onboarding:privacy')}
        </AppText>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: spacing.m, marginTop: spacing.xxl },
  icon: { width: 112, height: 112, borderRadius: 26, marginBottom: spacing.m },
  card: { padding: spacing.xl, gap: spacing.m },
});
