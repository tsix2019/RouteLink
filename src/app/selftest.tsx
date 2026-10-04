import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RouteLinkNative from 'routelink-native';

import { runSelfTest, type CheckResult } from '@/features/selftest/run';
import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Only self-test builds (CI) expose this screen; everyone else is sent home. */
const ENABLED = process.env.EXPO_PUBLIC_SELFTEST === '1';

/**
 * routelink://selftest?http=&https=&fp=&report= — runs the native networking checks against the CI's
 * local servers and POSTs { passed, results } to `report`.
 */
export default function SelfTest() {
  if (!ENABLED) return <Redirect href="/" />;
  return <SelfTestRunner />;
}

function SelfTestRunner() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { http, https, fp, report } = useLocalSearchParams<{
    http?: string;
    https?: string;
    fp?: string;
    report?: string;
  }>();
  const [results, setResults] = useState<CheckResult[] | null>(null);

  useEffect(() => {
    if (!http || !https || !fp) return;
    let cancelled = false;
    void runSelfTest(RouteLinkNative, { http, https, fp, platform: Platform.OS === 'ios' ? 'ios' : 'android' }).then(
      async (r) => {
        if (cancelled) return;
        setResults(r);
        if (report) {
          await RouteLinkNative.httpRequest({
            url: report,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passed: r.every((x) => x.passed), results: r }),
          }).catch(() => {});
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [http, https, fp, report]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}>
      <AppText variant="title">Self-test</AppText>
      {!http || !https || !fp ? <AppText tone="danger">Missing http, https or fp parameter</AppText> : null}
      {results === null ? <AppText tone="secondary">Running…</AppText> : null}
      {results?.map((r) => (
        <View key={r.name} style={styles.row} testID={`selftest-${r.name}`}>
          <AppText weight="600" tone={r.passed ? 'success' : 'danger'}>
            {r.passed ? 'PASS' : 'FAIL'}
          </AppText>
          <View style={styles.flex}>
            <AppText variant="mono">{r.name}</AppText>
            {r.detail ? (
              <AppText variant="footnote" tone="secondary">
                {r.detail}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.l, gap: spacing.m },
  row: { flexDirection: 'row', gap: spacing.m, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
