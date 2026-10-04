import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useReconnectDraft } from '@/features/wireless/reconnectDraft';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';

/** After changing the network the phone is on: how to get back. */
export default function Reconnect() {
  const t = useT();
  const nav = useRouter();
  const { ssid, key } = useReconnectDraft();
  return (
    <Screen title={t('wireless:reconnect.title')} inTabs>
      <AppText variant="body" tone="secondary">
        {t('wireless:reconnect.body')}
      </AppText>
      <GlassCard icon="wifi" title={ssid}>
        {key ? <TextField label={t('wireless:reconnect.password')} value={key} editable={false} secret /> : null}
      </GlassCard>
      <View style={styles.steps}>
        {[t('wireless:reconnect.step1'), t('wireless:reconnect.step2'), t('wireless:reconnect.step3')].map(
          (step, i) => (
            <View key={step} style={styles.step}>
              <AppText variant="headline" tone="accent">
                {i + 1}
              </AppText>
              <AppText variant="body" style={styles.flex}>
                {step}
              </AppText>
            </View>
          ),
        )}
      </View>
      <GlassButton label={t('wireless:reconnect.done')} variant="primary" onPress={() => nav.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  steps: { gap: spacing.m },
  step: { flexDirection: 'row', gap: spacing.m, alignItems: 'flex-start' },
});
