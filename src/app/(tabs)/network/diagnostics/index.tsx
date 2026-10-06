import { useRouter } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import type { SegmentResult } from '@/features/diagnostics/diagnose';
import { ADVICE_HREF, diagnosisText, headline, segmentFacts } from '@/features/diagnostics/present';
import { SEGMENTS, type SegmentId } from '@/features/diagnostics/rules';
import { StatusMark, statusColor, type MarkState } from '@/features/diagnostics/StatusMark';
import { useDiagnosis } from '@/features/diagnostics/useDiagnosis';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner, EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatClock } from '@/utils/dates';

/** One-click diagnosis (design §18.1, DG-1): every hop from the phone to the internet, near to far. */
export default function Diagnosis() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const { colors } = useTheme();
  const { router, connection } = useActiveRouter();
  const d = useDiagnosis();
  const head = headline(t, d.results, d.running);
  const by = new Map(d.results.map((r) => [r.segment, r]));
  const done = !d.running && d.results.length > 0;

  const share = () => {
    const name = router?.isDemo ? t('demoRouter') : (router?.name ?? '');
    const at = Math.floor((d.finishedAt ?? Date.now()) / 1000);
    void Share.share({ message: diagnosisText(t, lang, { router: name, at, results: d.results, plugin: d.plugin }) });
  };
  const stateOf = (segment: SegmentId, index: number): MarkState => {
    const r = by.get(segment);
    if (r) return r.verdict.status;
    return d.running && !d.error && index === d.results.length ? 'running' : 'pending';
  };
  const headState: MarkState = head.status === 'running' ? 'running' : head.status;
  const seconds = d.startedAt && d.finishedAt ? Math.max(1, Math.round((d.finishedAt - d.startedAt) / 1000)) : 0;

  return (
    <Screen
      title={t('diagnostics:diagnose.title')}
      headerRight={
        done ? (
          <HeaderButton
            icon="share"
            onPress={share}
            accessibilityLabel={t('diagnostics:diagnose.share')}
            testID="diagnosis-share"
          />
        ) : undefined
      }
      onRefresh={d.running ? undefined : d.rerun}>
      {!connection ? (
        <EmptyState icon="router" title={t('errors:connection.offline')} />
      ) : (
        <>
          <GlassCard contentStyle={styles.head} testID="diagnosis-headline">
            <View style={styles.headRow}>
              <StatusMark state={headState} size={36} />
              <View style={styles.flex}>
                <AppText
                  variant="title"
                  style={head.status !== 'running' ? { color: statusColor(colors, headState) } : undefined}>
                  {head.title}
                </AppText>
                <AppText variant="footnote" tone="secondary">
                  {d.running
                    ? t('diagnostics:diagnose.progress', { done: d.results.length, total: SEGMENTS.length })
                    : d.finishedAt
                      ? t('diagnostics:diagnose.finished', {
                          time: formatClock(Math.floor(d.finishedAt / 1000)),
                          seconds,
                        })
                      : ''}
                </AppText>
              </View>
            </View>
            <Progress done={d.running ? d.results.length : SEGMENTS.length} total={SEGMENTS.length} />
            {!d.running ? (
              <GlassButton
                label={t('diagnostics:diagnose.again')}
                icon="refresh"
                variant="glass"
                compact
                onPress={d.rerun}
                testID="diagnosis-again"
              />
            ) : null}
          </GlassCard>
          {d.error ? (
            <Banner tone="error" text={t('diagnostics:diagnose.failed', { reason: describeError(t, d.error).title })} />
          ) : null}
          <ListSection footer={t('diagnostics:diagnose.footer')}>
            {SEGMENTS.map((segment, i) => (
              <SegmentRow
                key={segment}
                segment={segment}
                state={stateOf(segment, i)}
                result={by.get(segment)}
                plugin={d.plugin}
                onOpen={(href) => nav.push(href, { withAnchor: true })}
              />
            ))}
          </ListSection>
        </>
      )}
    </Screen>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.fill }]}>
      <View style={[styles.bar, { backgroundColor: colors.accent, width: `${(done / total) * 100}%` }]} />
    </View>
  );
}

function SegmentRow({
  segment,
  state,
  result,
  plugin,
  onOpen,
}: {
  segment: SegmentId;
  state: MarkState;
  result?: SegmentResult;
  plugin: boolean;
  onOpen(href: string): void;
}) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const facts = result ? segmentFacts(t, lang, result, { plugin }) : [];
  const advice = result?.verdict.advice ?? [];
  return (
    <View style={styles.segment} testID={`segment-${segment}`}>
      <View style={styles.segmentHead}>
        <StatusMark state={state} />
        <View style={styles.flex}>
          <AppText variant="body">{t(`diagnostics:segment.${segment}`)}</AppText>
          {result ? (
            facts.map((line) => (
              <AppText key={line} variant="footnote" tone="secondary">
                {line}
              </AppText>
            ))
          ) : (
            <AppText variant="footnote" tone="tertiary">
              {t(state === 'running' ? 'diagnostics:status.running' : 'diagnostics:status.pending')}
            </AppText>
          )}
        </View>
        {result && result.verdict.status !== 'ok' ? (
          <AppText variant="footnote" weight="600" style={{ color: statusColor(colors, result.verdict.status) }}>
            {t(`diagnostics:status.${result.verdict.status}`)}
          </AppText>
        ) : null}
      </View>
      {advice.map((a) => {
        const href = ADVICE_HREF[a];
        return (
          <Pressable
            key={a}
            accessibilityRole={href ? 'link' : 'text'}
            disabled={!href}
            onPress={href ? () => onOpen(href) : undefined}
            style={({ pressed }) => [styles.advice, { backgroundColor: pressed ? colors.separator : colors.fill }]}
            testID={`advice-${a}`}>
            <Icon name={href ? 'bolt' : 'info'} size={16} color={href ? colors.accent : colors.textSecondary} />
            <AppText variant="footnote" tone={href ? 'accent' : 'secondary'} style={styles.flex}>
              {t(`diagnostics:advice.${a}`)}
            </AppText>
            {href ? <Icon name="chevronRight" size={14} color={colors.textTertiary} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.m },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  flex: { flex: 1, gap: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  segment: { paddingHorizontal: spacing.l, paddingVertical: spacing.m, gap: spacing.s },
  segmentHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.m },
  advice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginLeft: 26 + spacing.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 10,
  },
});
