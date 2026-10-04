import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, View, type ScrollView } from 'react-native';

import type { LogLine } from '@/api/services/logs';
import { useKernelLog, useSystemLog } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { HeaderButton, Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';

/** At most this many lines are drawn; the full log is still shared. */
const MAX_LINES = 600;

const lineText = (l: LogLine) => [l.time, l.source ? `${l.source}:` : null, l.text].filter(Boolean).join(' ');

/** System (syslog) and kernel (dmesg) logs: filter, newest at the bottom, share. */
export default function Logs() {
  const t = useT();
  const { colors } = useTheme();
  const [kind, setKind] = useState<'system' | 'kernel'>('system');
  const [query, setQuery] = useState('');
  const system = useSystemLog();
  const kernel = useKernelLog();
  const log = kind === 'system' ? system : kernel;
  const scroll = useRef<ScrollView | null>(null);

  const q = query.trim().toLowerCase();
  const all = log.data ?? [];
  const matching = q ? all.filter((l) => lineText(l).toLowerCase().includes(q)) : all;
  const shown = matching.slice(-MAX_LINES);

  // Logs are read bottom-up: jump to the newest line whenever the content changes.
  useEffect(() => {
    if (log.data) requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
  }, [log.data, kind, q]);

  const color = (l: LogLine) =>
    l.level === 'emerg' || l.level === 'alert' || l.level === 'crit' || l.level === 'err'
      ? colors.danger
      : l.level === 'warn'
        ? colors.warning
        : colors.text;

  return (
    <Screen
      title={t('more:logs')}
      scrollRef={scroll}
      refreshing={log.isRefetching}
      onRefresh={() => void log.refetch()}
      headerRight={
        <HeaderButton
          icon="share"
          accessibilityLabel={t('more:logsScreen.share')}
          onPress={() => void Share.share({ message: matching.map(lineText).join('\n') })}
        />
      }>
      <SegmentedControl
        values={[t('more:logsScreen.system'), t('more:logsScreen.kernel')]}
        selectedIndex={kind === 'system' ? 0 : 1}
        onChange={(e) => setKind(e.nativeEvent.selectedSegmentIndex === 0 ? 'system' : 'kernel')}
      />
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t('more:logsScreen.filter')}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {log.data ? (
        shown.length ? (
          <GlassCard contentStyle={styles.lines}>
            <AppText variant="caption" tone="tertiary">
              {t('more:logsScreen.count', { shown: shown.length, total: all.length })}
            </AppText>
            {shown.map((l, i) => (
              <AppText key={i} selectable style={[styles.line, { color: color(l) }]}>
                {l.time ? (
                  <AppText style={[styles.line, { color: colors.textTertiary }]}>{`${l.time} `}</AppText>
                ) : null}
                {l.source ? <AppText style={[styles.line, { color: colors.accent }]}>{`${l.source}: `}</AppText> : null}
                {l.text}
              </AppText>
            ))}
          </GlassCard>
        ) : (
          <EmptyState icon="logs" title={q ? t('more:logsScreen.noMatch') : t('more:logsScreen.empty')} />
        )
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} height={14} width={`${60 + ((i * 17) % 40)}%`} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
  line: { fontFamily: MONO_FONT, fontSize: 11, lineHeight: 16 },
  loading: { gap: spacing.s, padding: spacing.l },
});
