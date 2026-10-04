import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { spacing } from '@/ui/theme/tokens';

const REPO = 'https://github.com/tsix2019/RouteLink';

export default function About() {
  const t = useT();
  const version = Constants.expoConfig?.version ?? '—';
  return (
    <Screen title={t('more:about')}>
      <View style={styles.hero}>
        <Image source={require('@/assets/images/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
        <AppText variant="title">RouteLink</AppText>
        <AppText variant="subhead" tone="secondary">
          {t('more:aboutScreen.version', { version })}
        </AppText>
      </View>
      <ListSection>
        <ListRow
          title={t('more:aboutScreen.source')}
          subtitle="github.com/tsix2019/RouteLink"
          icon="link"
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(REPO)}
        />
      </ListSection>
      <GlassCard title={t('more:aboutScreen.privacy')} icon="shield">
        <AppText variant="subhead" tone="secondary">
          {t('more:aboutScreen.privacyText')}
        </AppText>
      </GlassCard>
      <AppText variant="footnote" tone="tertiary" align="center">
        {t('more:aboutScreen.license')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.s, paddingVertical: spacing.l },
  icon: { width: 88, height: 88, borderRadius: 20 },
});
