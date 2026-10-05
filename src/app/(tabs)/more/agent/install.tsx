import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { InstallStep } from '@/features/agent/install';
import { useInstallSession } from '@/features/agent/installSession';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useLang, useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBytes } from '@/utils/format';

import { MANUAL_URL } from './index';

type StepId = Exclude<InstallStep['step'], 'done' | 'failed'>;
const ORDER: StepId[] = ['detect', 'manifest', 'download', 'lists', 'upload', 'install', 'verify'];
type Phase = 'pending' | 'active' | 'done' | 'failed';

/** Which phase each step is in, from the steps reported so far. */
function phases(steps: InstallStep[]): Record<StepId, Phase> {
  const out = Object.fromEntries(ORDER.map((s) => [s, 'pending'])) as Record<StepId, Phase>;
  const seen = steps.filter((s): s is Extract<InstallStep, { step: StepId }> => ORDER.includes(s.step as StepId));
  const current = seen[seen.length - 1]?.step;
  const last = steps[steps.length - 1];
  for (const s of seen) out[s.step] = 'done';
  // upload and install alternate per package: the last reported one is the active one.
  if (current) out[current] = last?.step === 'failed' ? 'failed' : last?.step === 'done' ? 'done' : 'active';
  if (current === 'install' && last?.step !== 'failed' && last?.step !== 'done') out.upload = 'done';
  if (last?.step === 'done') ORDER.forEach((s) => out[s] !== 'pending' && (out[s] = 'done'));
  return out;
}

/** One-tap install progress (design §13.3): one row per step, the result and what to do about a failure. */
export default function InstallAgent() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const client = useQueryClient();
  const { router, connection } = useActiveRouter();
  const { colors } = useTheme();
  const mirror = useSettings((s) => s.agentMirror);
  const session = useInstallSession();
  const steps = session.routerId === router?.id ? session.steps : [];
  const last = steps[steps.length - 1];
  const p = phases(steps);
  // The lists step only happens on routers without package lists.
  const shown = ORDER.filter((s) => s !== 'lists' || p.lists !== 'pending');

  const progress = (id: StepId) => {
    const s = [...steps].reverse().find((x) => x.step === id);
    if (!s || !('index' in s)) return null;
    const of = t('agent:install.progress', { index: s.index + 1, total: s.total });
    return s.step === 'upload' ? `${of} · ${formatBytes(s.sent)} / ${formatBytes(s.size)}` : of;
  };

  const finish = () => {
    void client.invalidateQueries({ queryKey: [router?.id ?? 'none'] });
    session.reset();
    nav.back();
  };

  return (
    <Screen title={t('agent:install.screen')}>
      <GlassCard>
        {shown.map((id) => {
          const phase = p[id];
          return (
            <View key={id} style={styles.step} testID={`install-step-${id}`}>
              <View style={styles.marker}>
                {phase === 'active' ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : phase === 'done' ? (
                  <Icon name="check" size={18} color={colors.success} />
                ) : phase === 'failed' ? (
                  <Icon name="error" size={18} color={colors.danger} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: colors.separator }]} />
                )}
              </View>
              <View style={styles.stepText}>
                <AppText variant="body" tone={phase === 'pending' ? 'tertiary' : 'primary'}>
                  {t(`agent:install.steps.${id}`)}
                </AppText>
                {phase === 'active' && progress(id) ? (
                  <AppText variant="footnote" tone="secondary">
                    {progress(id)}
                  </AppText>
                ) : null}
              </View>
            </View>
          );
        })}
      </GlassCard>

      {last?.step === 'done' ? (
        <GlassCard title={t('agent:install.done', { version: last.version })} icon="check">
          <AppText variant="subhead" tone="secondary">
            {t('agent:install.doneMessage')}
          </AppText>
          <GlassButton label={t('agent:install.finish')} variant="primary" onPress={finish} testID="install-finish" />
        </GlassCard>
      ) : last?.step === 'failed' ? (
        <GlassCard
          title={t(`agent:install.failed.${last.reason}`, { ...failureArgs(last.detail) })}
          icon="warning"
          testID="install-failed">
          {last.detail && last.reason !== 'dependencies' && last.reason !== 'no-space' ? (
            <AppText variant="footnote" tone="tertiary" numberOfLines={6} selectable>
              {last.detail}
            </AppText>
          ) : null}
          <View style={styles.buttons}>
            <GlassButton
              label={t('agent:install.manual')}
              onPress={() => void WebBrowser.openBrowserAsync(MANUAL_URL[lang])}
              style={styles.button}
            />
            <GlassButton
              label={t('agent:install.retry')}
              variant="primary"
              onPress={() => connection && void session.start(connection, mirror)}
              style={styles.button}
              testID="install-retry"
            />
          </View>
        </GlassCard>
      ) : null}
    </Screen>
  );
}

/** "need/free" in KB for no-space; missing package names for dependencies. */
function failureArgs(detail?: string): { detail: string; need: string; free: string } {
  if (!detail) return { detail: '', need: '?', free: '?' };
  const space = /^(\d+)\/(\d+)$/.exec(detail);
  if (space) return { need: formatBytes(+space[1] * 1024), free: formatBytes(+space[2] * 1024), detail };
  return { detail, need: '?', free: '?' };
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, minHeight: 40 },
  marker: { width: 24, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stepText: { flex: 1, gap: 2 },
  buttons: { flexDirection: 'row', gap: spacing.m },
  button: { flex: 1 },
});
