import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { presetOf } from '@/ai/presets';
import type { ToolCall, ToolResult } from '@/ai/types';
import {
  AnswerActions,
  AssistantMark,
  NoticeButtons,
  NoticeCard,
  ThinkingDots,
  ToolSteps,
  UserBubble,
} from '@/features/assistant/ChatParts';
import { Composer, usePageColor } from '@/features/assistant/Composer';
import { describeCall } from '@/features/assistant/describe';
import { HistoryDrawer } from '@/features/assistant/HistoryDrawer';
import { MarkdownText } from '@/features/assistant/MarkdownText';
import { answerOf, toolResults, toTurns, type Turn } from '@/features/assistant/turns';
import { useAssistantChat, type ChatError } from '@/features/assistant/useAssistantChat';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useClients } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useAssistant } from '@/state/assistant';
import { AppText } from '@/ui/AppText';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Icons for the suggested questions, in their order. */
const SUGGESTION_ICONS: IconName[] = ['overview', 'devices', 'wifi', 'antenna'];

/**
 * MO-15 / OV-6: the AI assistant for the active router (design §18), laid out like the chat apps: answers
 * full width, questions in bubbles, the steps the assistant took folded into one line, a floating message box,
 * and the router's earlier conversations in a drawer.
 */
export default function Assistant() {
  const t = useT();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { page } = usePageColor();
  const lang = useLang();
  const { router, connection } = useActiveRouter();
  const consented = useAssistant((s) => s.consented);
  const provider = useAssistant((s) => s.provider);
  const clients = useClients().data;
  const chat = useAssistantChat({ routerId: router?.id, connection, language: lang });
  const refs = useAssistant((s) => (chat.id ? s.conversations[chat.id]?.refs : undefined));
  const [text, setText] = useState('');
  const [drawer, setDrawer] = useState({ open: false, at: 0 });
  const closeDrawer = () => setDrawer((d) => ({ ...d, open: false }));
  // A new key when another conversation opens: its messages appear at once instead of animating in.
  const [shownKey, setShownKey] = useState(0);
  const [jump, setJump] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const atEnd = useRef(true);
  const drawerProgress = useSharedValue(0);
  const demo = connection?.kind === 'demo';
  const canChat = consented || demo;
  const providerName = t(`assistant:setup.presets.${presetOf(provider.preset).id}`);
  const routerName = router ? (router.isDemo ? t('demoRouter') : router.name) : '';
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  const asked = useRef(false);
  const suggestions = t('assistant:suggestions', { returnObjects: true }) as string[];
  const turns = toTurns(chat.messages);
  const results = toolResults(chat.messages);
  const empty = turns.length === 0 && !chat.answering;

  // routelink://demo?route=/assistant: the demo asks its first suggested question by itself (screenshots).
  useEffect(() => {
    if (!demo || !ask || asked.current || chat.messages.length || !connection) return;
    asked.current = true;
    chat.send(suggestions[0]);
  }, [demo, ask, chat, connection, suggestions]);

  const submit = (value = text) => {
    if (!value.trim() || chat.busy || !canChat) return;
    atEnd.current = true;
    chat.send(value);
    setText('');
  };
  const show = (action: () => void) => {
    closeDrawer();
    atEnd.current = true;
    setShownKey((k) => k + 1);
    action();
  };
  const toEnd = (animated: boolean) => scroll.current?.scrollToEnd({ animated });
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromEnd = contentSize.height - contentOffset.y - layoutMeasurement.height;
    atEnd.current = fromEnd < 64;
    if (fromEnd > 240 !== jump) setJump(fromEnd > 240);
    if (contentOffset.y > 4 !== scrolled) setScrolled(contentOffset.y > 4);
  };
  // The screen steps back a little while the drawer is open, as in the chat apps.
  const behind = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawerProgress.get(), [0, 1], [0, 28]) }],
  }));

  return (
    <View style={[styles.page, { backgroundColor: page }]}>
      <Animated.View style={[styles.flex, behind]}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + spacing.xs, borderBottomColor: scrolled ? colors.separator : 'transparent' },
          ]}>
          <BarButton
            icon="menu"
            label={t('assistant:history.open')}
            onPress={() => {
              void Haptics.selectionAsync();
              setDrawer({ open: true, at: Date.now() });
            }}
            testID="assistant-history-open"
          />
          <View style={styles.titleBox} pointerEvents="none">
            <AppText variant="headline" numberOfLines={1}>
              {t('assistant:title')}
            </AppText>
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {routerName}
              {demo ? '' : ` · ${providerName}`}
            </AppText>
          </View>
          <BarButton
            icon="compose"
            label={t('assistant:newChat')}
            onPress={() => show(chat.newChat)}
            disabled={!chat.id}
            testID="assistant-new"
          />
          <BarButton icon="close" label={t('assistant:close')} onPress={() => nav.back()} testID="assistant-close" />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <View style={styles.flex}>
            <ScrollView
              ref={scroll}
              style={styles.flex}
              contentContainerStyle={[styles.content, empty && styles.contentEmpty]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onScroll={onScroll}
              scrollEventThrottle={32}
              onLayout={() => atEnd.current && toEnd(false)}
              onContentSizeChange={() => atEnd.current && toEnd(true)}>
              <LayoutAnimationConfig skipEntering key={shownKey}>
                {demo ? (
                  <View style={[styles.demo, { backgroundColor: colors.fill }]}>
                    <Icon name="demo" size={13} color={colors.textSecondary} />
                    <AppText variant="caption" tone="secondary" style={styles.flexShrink}>
                      {t('assistant:demoNote')}
                    </AppText>
                  </View>
                ) : null}
                {empty ? (
                  <Welcome
                    routerName={routerName}
                    consent={canChat ? null : providerName}
                    onSettings={() => nav.push('/more/assistant')}
                  />
                ) : null}
                {turns.map((turn, i) => (
                  <TurnView
                    key={turn.key}
                    turn={turn}
                    results={results}
                    last={i === turns.length - 1}
                    chat={chat}
                    describe={(call) => describeCall(t, call, refs ?? {}, clients)}
                  />
                ))}
                {chat.error ? (
                  <ErrorNotice error={chat.error} provider={providerName} onRetry={chat.regenerate} />
                ) : null}
              </LayoutAnimationConfig>
            </ScrollView>

            {jump ? (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.jump}>
                <Pressable
                  onPress={() => {
                    atEnd.current = true;
                    toEnd(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('assistant:scrollDown')}
                  hitSlop={8}>
                  <GlassSurface variant="pill" style={styles.jumpButton}>
                    <Icon name="down" size={18} color={colors.text} />
                  </GlassSurface>
                </Pressable>
              </Animated.View>
            ) : null}
          </View>

          {empty && canChat ? <Suggestions items={suggestions} onPick={submit} /> : null}
          <Composer
            value={text}
            onChangeText={setText}
            onSend={() => submit()}
            onStop={chat.stop}
            answering={chat.answering}
            editable={canChat}
          />
        </KeyboardAvoidingView>
      </Animated.View>

      <HistoryDrawer
        visible={drawer.open}
        now={drawer.at}
        progress={drawerProgress}
        routerId={router?.id}
        routerName={routerName}
        currentId={chat.id}
        onClose={closeDrawer}
        onOpen={(id) => show(() => chat.open(id))}
        onNew={() => show(chat.newChat)}
        onSettings={() => {
          closeDrawer();
          nav.push('/more/assistant');
        }}
      />
    </View>
  );
}

/** One question and its answer: the steps taken, the text, and the actions under it once it is done. */
function TurnView({
  turn,
  results,
  last,
  chat,
  describe,
}: {
  turn: Turn;
  results: Map<string, ToolResult>;
  last: boolean;
  chat: ReturnType<typeof useAssistantChat>;
  describe(call: ToolCall): string;
}) {
  const t = useT();
  const { colors } = useTheme();
  const live = last && chat.answering;
  const end = turn.parts[turn.parts.length - 1];
  const toolRunning = end?.kind === 'tools' && end.calls.some((c) => !results.has(c.id));
  const answer = answerOf(turn);
  return (
    <View style={styles.turn}>
      {turn.question ? <UserBubble text={turn.question} /> : null}
      <View style={styles.answer}>
        {turn.parts.map((p, i) =>
          p.kind === 'text' ? (
            <MarkdownText key={i} text={p.text} />
          ) : (
            <ToolSteps key={i} calls={p.calls} results={results} pendingId={live ? chat.pending?.call.id : undefined} />
          ),
        )}
        {live && chat.streaming ? <MarkdownText text={chat.streaming} caret /> : null}
        {live && !chat.streaming && !chat.pending && !toolRunning ? <ThinkingDots /> : null}
        {live && chat.pending ? (
          <NoticeCard
            icon="warning"
            tint={colors.warning}
            title={t('assistant:confirm.title')}
            testID="assistant-confirm">
            <AppText variant="body" style={styles.noticeText}>
              {describe(chat.pending.call)}
            </AppText>
            <NoticeButtons
              buttons={[
                {
                  label: t('assistant:confirm.cancel'),
                  onPress: () => chat.decide(false),
                  testID: 'assistant-decline',
                },
                {
                  label: t('assistant:confirm.run'),
                  variant: 'warning',
                  onPress: () => chat.decide(true),
                  testID: 'assistant-run',
                },
              ]}
            />
          </NoticeCard>
        ) : null}
        {!live && (answer || (last && !chat.busy)) ? (
          <AnswerActions text={answer} onRegenerate={last && !chat.busy ? chat.regenerate : undefined} />
        ) : null}
      </View>
    </View>
  );
}

/** A new conversation: the assistant's mark, a greeting and what it can do; or, before the first use, consent. */
function Welcome({
  routerName,
  consent,
  onSettings,
}: {
  routerName: string;
  /** The provider's name while the user has not agreed yet. */
  consent: string | null;
  onSettings(): void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const agree = useAssistant((s) => s.consent);
  return (
    <View style={styles.welcome}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.hero}>
        <AssistantMark size={60} breathing />
        <AppText variant="title" align="center">
          {t('assistant:greeting')}
        </AppText>
        {routerName ? (
          <View style={[styles.routerPill, { backgroundColor: colors.fill }]}>
            <Icon name="router" size={13} color={colors.textSecondary} />
            <AppText variant="footnote" tone="secondary" numberOfLines={1}>
              {routerName}
            </AppText>
          </View>
        ) : null}
        {consent ? null : (
          <AppText variant="subhead" tone="secondary" align="center" style={styles.blurb}>
            {t('assistant:empty')}
          </AppText>
        )}
      </Animated.View>
      {consent ? (
        <NoticeCard icon="shield" tint={colors.accent} title={t('assistant:consent.title')}>
          <AppText variant="subhead">{t('assistant:consent.body', { provider: consent })}</AppText>
          <AppText variant="subhead">{t('assistant:consent.privacy')}</AppText>
          <AppText variant="subhead">{t('assistant:consent.writes')}</AppText>
          <NoticeButtons
            buttons={[
              { label: t('assistant:consent.openSettings'), onPress: onSettings },
              { label: t('assistant:consent.agree'), variant: 'primary', onPress: agree, testID: 'assistant-consent' },
            ]}
          />
        </NoticeCard>
      ) : null}
    </View>
  );
}

/** Questions to start with, in cards that scroll sideways above the message box. */
function Suggestions({ items, onPick }: { items: string[]; onPick(text: string): void }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(120).duration(360)} exiting={FadeOut.duration(150)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.suggestions}>
        {items.map((s, i) => (
          <Pressable
            key={s}
            onPress={() => {
              void Haptics.selectionAsync();
              onPick(s);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.suggestion,
              { backgroundColor: colors.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
            testID={`assistant-suggestion-${i}`}>
            <Icon name={SUGGESTION_ICONS[i] ?? 'sparkles'} size={18} color={colors.accent} />
            <AppText variant="subhead" numberOfLines={2}>
              {s}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

function ErrorNotice({ error, provider, onRetry }: { error: ChatError; provider: string; onRetry(): void }) {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const settings = error.kind === 'no-key' || error.kind === 'auth' || error.kind === 'quota';
  const buttons = [
    ...(settings ? [{ label: t('assistant:openSettings'), onPress: () => nav.push('/more/assistant') }] : []),
    ...(error.kind === 'no-key'
      ? []
      : [{ label: t('assistant:retry'), variant: 'primary' as const, onPress: onRetry }]),
  ];
  return (
    <NoticeCard icon="warning" tint={colors.danger}>
      <AppText variant="subhead">
        {error.kind === 'no-key'
          ? t('assistant:noKey', { provider })
          : t(`assistant:error.${error.kind}`, { message: error.message })}
      </AppText>
      <NoticeButtons buttons={buttons} />
    </NoticeCard>
  );
}

function BarButton({
  icon,
  label,
  onPress,
  disabled,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      testID={testID}
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}>
      <GlassSurface variant="pill" style={styles.barButton}>
        <Icon name={icon} size={20} color={colors.text} />
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleBox: { flex: 1, minWidth: 0, alignItems: 'center', paddingLeft: 48 },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.l + 2, paddingTop: spacing.m, paddingBottom: spacing.xl, gap: spacing.xl },
  contentEmpty: { flexGrow: 1 },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: 999,
  },
  welcome: { flexGrow: 1, justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.l },
  hero: { alignItems: 'center', gap: spacing.m },
  routerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.m,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: '80%',
  },
  blurb: { paddingHorizontal: spacing.l, lineHeight: 21 },
  turn: { gap: spacing.l },
  answer: { gap: spacing.m },
  noticeText: { fontSize: 16, lineHeight: 23, letterSpacing: 0 },
  suggestions: { paddingHorizontal: spacing.m, paddingBottom: spacing.s, gap: spacing.s },
  suggestion: { width: 156, minHeight: 84, borderRadius: 18, padding: spacing.m, gap: spacing.s },
  jump: { position: 'absolute', bottom: spacing.m, alignSelf: 'center' },
  jumpButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
