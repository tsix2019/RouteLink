import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { TOOLS } from '@/ai/tools';
import type { ToolCall, ToolResult } from '@/ai/types';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const DECLINED = 'The user declined this action.';
/** The assistant's colours: indigo through blue to teal. */
export const AI_GRADIENT = ['#5E5CE6', '#0A84FF', '#40C8E0'] as const;

/** The assistant's mark: a gradient disc with sparkles; it breathes while the assistant waits for you. */
export function AssistantMark({ size = 28, breathing }: { size?: number; breathing?: boolean }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!breathing) return;
    scale.set(
      withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [breathing, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const round: ViewStyle = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Animated.View style={[styles.mark, round, style]}>
      <LinearGradient
        colors={AI_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Icon name="sparkles" size={Math.round(size * 0.5)} color="#FFFFFF" />
    </Animated.View>
  );
}

/** Three dots that take turns to rise: the assistant is thinking. */
export function ThinkingDots() {
  const t = useT();
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={styles.thinking}
      accessibilityRole="progressbar"
      accessibilityLabel={t('assistant:thinking')}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 160} />
      ))}
    </Animated.View>
  );
}

function Dot({ delay }: { delay: number }) {
  const { colors } = useTheme();
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
            withTiming(0, { duration: 320 }),
          ),
          -1,
        ),
      ),
    );
  }, [delay, lift]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + lift.get() * 0.65,
    transform: [{ translateY: -lift.get() * 5 }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: colors.textSecondary }, style]} />;
}

/** Text that glows on and off while its step runs. */
function Pulse({ children }: { children: React.ReactNode }) {
  const glow = useSharedValue(1);
  useEffect(() => {
    glow.set(withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View style={[styles.flexShrink, style]}>{children}</Animated.View>;
}

/** The question, in a bubble on the right. Long press copies it. */
export function UserBubble({ text }: { text: string }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const copy = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void Clipboard.setStringAsync(text).then(() => toast(t('assistant:copied')));
  };
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.userRow}>
      <Pressable
        onLongPress={copy}
        delayLongPress={350}
        style={({ pressed }) => [styles.bubble, { backgroundColor: colors.fill, opacity: pressed ? 0.75 : 1 }]}>
        <AppText variant="body" style={styles.bubbleText}>
          {text}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

type StepState = 'running' | 'waiting' | 'done' | 'failed' | 'declined';

function stateOf(result: ToolResult | undefined, waiting: boolean): StepState {
  if (!result) return waiting ? 'waiting' : 'running';
  if (result.content === DECLINED) return 'declined';
  return result.isError ? 'failed' : 'done';
}

const STEP_ICON: Record<Exclude<StepState, 'running'>, IconName> = {
  waiting: 'hourglass',
  done: 'check',
  failed: 'warning',
  declined: 'close',
};

/**
 * What the assistant looked at or did between two pieces of its answer, in one line: the step running now, or
 * a summary that opens into the steps, each with how it went.
 */
export function ToolSteps({
  calls,
  results,
  pendingId,
}: {
  calls: ToolCall[];
  results: Map<string, ToolResult>;
  pendingId?: string;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const steps = calls.map((call) => {
    const known = TOOLS.some((tool) => tool.name === call.name);
    const name = known ? t(`assistant:tool.names.${call.name as 'get_overview'}`) : call.name;
    return { call, name, state: stateOf(results.get(call.id), call.id === pendingId) };
  });
  const active = steps.find((s) => s.state === 'running' || s.state === 'waiting');
  const trouble = steps.some((s) => s.state === 'failed');
  const label = (s: (typeof steps)[number]) =>
    s.state === 'waiting' ? `${t('assistant:tool.waiting')} ${s.name}` : `${t(`assistant:tool.${s.state}`)} ${s.name}`;
  const expandable = !active && steps.length > 1;

  return (
    <Animated.View entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)} style={styles.steps}>
      <Pressable
        disabled={!expandable}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityState={expandable ? { expanded: open } : undefined}
        hitSlop={6}
        style={styles.stepRow}>
        {active?.state === 'running' ? (
          <ActivityIndicator size="small" color={colors.textSecondary} style={styles.spinner} />
        ) : (
          <Icon
            name={
              active
                ? 'hourglass'
                : trouble
                  ? 'warning'
                  : steps.length > 1
                    ? 'logs'
                    : STEP_ICON[steps[0].state as 'done']
            }
            size={15}
            color={trouble ? colors.warning : colors.textSecondary}
          />
        )}
        {active ? (
          <Pulse>
            <AppText variant="footnote" tone="secondary" numberOfLines={1}>
              {active.state === 'running' ? `${label(active)}…` : label(active)}
            </AppText>
          </Pulse>
        ) : (
          <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.flexShrink}>
            {steps.length === 1 ? label(steps[0]) : t('assistant:tool.steps', { count: steps.length })}
          </AppText>
        )}
        {expandable ? (
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} color={colors.textTertiary} />
        ) : null}
      </Pressable>
      {open && expandable ? (
        <Animated.View entering={FadeIn.duration(180)} style={[styles.stepList, { borderLeftColor: colors.separator }]}>
          {steps.map((s) => (
            <View key={s.call.id} style={styles.stepRow}>
              <Icon
                name={STEP_ICON[s.state as Exclude<StepState, 'running'>]}
                size={13}
                color={s.state === 'failed' ? colors.warning : colors.textTertiary}
              />
              <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.flexShrink}>
                {label(s)}
              </AppText>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Under a finished answer: copy it, or (the last one) answer again. */
export function AnswerActions({ text, onRegenerate }: { text: string; onRegenerate?: () => void }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      toast(t('assistant:copied'));
    });
  };
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.actions}>
      {text ? (
        <ActionIcon
          icon={copied ? 'check' : 'copy'}
          label={t('assistant:copy')}
          onPress={copy}
          color={colors.textSecondary}
        />
      ) : null}
      {onRegenerate ? (
        <ActionIcon
          icon="refresh"
          label={t('assistant:regenerate')}
          onPress={() => {
            void Haptics.selectionAsync();
            onRegenerate();
          }}
          color={colors.textSecondary}
          testID="assistant-regenerate"
        />
      ) : null}
    </Animated.View>
  );
}

function ActionIcon({
  icon,
  label,
  onPress,
  color,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  color: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.actionIcon, pressed && { backgroundColor: colors.fill }]}>
      <Icon name={icon} size={16} color={color} />
    </Pressable>
  );
}

/** A tinted card inside the conversation: the write to confirm, an error, the consent. */
export function NoticeCard({
  icon,
  tint,
  title,
  children,
  testID,
}: {
  icon: IconName;
  tint: string;
  title?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      style={[styles.notice, { backgroundColor: `${tint}14`, borderColor: `${tint}40` }]}
      testID={testID}>
      <View style={styles.noticeTitle}>
        <View style={[styles.noticeIcon, { backgroundColor: `${tint}26` }]}>
          <Icon name={icon} size={16} color={tint} />
        </View>
        {title ? (
          <AppText variant="headline" style={styles.flexShrink}>
            {title}
          </AppText>
        ) : null}
      </View>
      {children}
    </Animated.View>
  );
}

export function NoticeButtons({
  buttons,
}: {
  buttons: { label: string; onPress(): void; variant?: 'primary' | 'warning'; testID?: string }[];
}) {
  return (
    <View style={styles.noticeButtons}>
      {buttons.map((b) => (
        <GlassButton
          key={b.label}
          label={b.label}
          variant={b.variant}
          compact
          onPress={b.onPress}
          style={styles.flex}
          testID={b.testID}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingLeft: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: { borderRadius: 20, paddingHorizontal: spacing.l, paddingVertical: 10 },
  bubbleText: { fontSize: 16, lineHeight: 23, letterSpacing: 0 },
  steps: { gap: spacing.xs, alignSelf: 'stretch' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22, alignSelf: 'flex-start' },
  spinner: { transform: [{ scale: 0.75 }], width: 15, height: 15 },
  stepList: { marginLeft: 7, paddingLeft: spacing.m, borderLeftWidth: 1.5, gap: 4, paddingVertical: 2 },
  actions: { flexDirection: 'row', gap: 2, marginLeft: -6 },
  actionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: spacing.l, gap: spacing.m },
  noticeTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  noticeIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  noticeButtons: { flexDirection: 'row', gap: spacing.s },
});
