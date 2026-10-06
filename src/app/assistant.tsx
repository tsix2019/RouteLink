import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { presetOf } from '@/ai/presets';
import { TOOLS } from '@/ai/tools';
import type { ChatMessage, ToolCall, ToolResult } from '@/ai/types';
import { describeCall } from '@/features/assistant/describe';
import { MarkdownText } from '@/features/assistant/MarkdownText';
import { useAssistantChat, type ChatError } from '@/features/assistant/useAssistantChat';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useClients } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useAssistant } from '@/state/assistant';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { Icon, type IconName } from '@/ui/Icon';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

const DECLINED = 'The user declined this action.';

/** MO-15 / OV-6: the AI assistant for the active router (design §18). */
export default function Assistant() {
  const t = useT();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const lang = useLang();
  const { router, connection } = useActiveRouter();
  const consented = useAssistant((s) => s.consented);
  const provider = useAssistant((s) => s.provider);
  const refs = useAssistant((s) => (router ? s.conversations[router.id]?.refs : undefined));
  const clients = useClients().data;
  const chat = useAssistantChat({ routerId: router?.id, connection, language: lang });
  const [text, setText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const demo = connection?.kind === 'demo';
  const providerName = t(`assistant:setup.presets.${presetOf(provider.preset).id}`);
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  const asked = useRef(false);
  const firstSuggestion = (t('assistant:suggestions', { returnObjects: true }) as string[])[0];

  // routelink://demo?route=/assistant: the demo asks its first suggested question by itself (screenshots).
  useEffect(() => {
    if (!demo || !ask || asked.current || chat.messages.length || !connection) return;
    asked.current = true;
    chat.send(firstSuggestion);
  }, [demo, ask, chat, connection, firstSuggestion]);

  const submit = (value = text) => {
    if (!value.trim() || chat.busy) return;
    chat.send(value);
    setText('');
  };
  const results = new Map<string, ToolResult>();
  for (const m of chat.messages) if (m.role === 'user') for (const r of m.results ?? []) results.set(r.id, r);

  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <BarButton icon="close" label={t('assistant:close')} onPress={() => nav.back()} testID="assistant-close" />
        <View style={styles.titleBox}>
          <AppText variant="headline">{t('assistant:title')}</AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {router ? (router.isDemo ? t('demoRouter') : router.name) : ''}
            {demo ? '' : ` · ${providerName}`}
          </AppText>
        </View>
        <BarButton icon="trash" label={t('assistant:clear')} onPress={() => setConfirmClear(true)} />
        <BarButton icon="settings" label={t('assistant:settings')} onPress={() => nav.push('/more/assistant')} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {demo ? (
            <AppText variant="footnote" tone="secondary" style={styles.center}>
              {t('assistant:demoNote')}
            </AppText>
          ) : null}
          {!consented && !demo ? (
            <Consent provider={providerName} onSettings={() => nav.push('/more/assistant')} />
          ) : null}
          {chat.messages.length === 0 && (consented || demo) ? (
            <View style={styles.empty}>
              <AppText variant="subhead" tone="secondary">
                {t('assistant:empty')}
              </AppText>
              <View style={styles.suggestions}>
                {(t('assistant:suggestions', { returnObjects: true }) as string[]).map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => submit(s)}
                    style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.separator }]}>
                    <AppText variant="subhead" style={{ color: colors.accent }}>
                      {s}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {chat.messages.map((m, i) => (
            <Message key={i} message={m} results={results} pendingId={chat.pending?.call.id} />
          ))}
          {chat.streaming ? (
            <View style={[styles.bubble, styles.assistant, { backgroundColor: colors.card }]}>
              <MarkdownText text={chat.streaming} />
            </View>
          ) : null}
          {chat.pending ? (
            <GlassSurface variant="card" style={styles.confirm} testID="assistant-confirm">
              <View style={styles.row}>
                <Icon name="warning" size={20} color={colors.warning} />
                <AppText variant="headline" style={styles.flex}>
                  {t('assistant:confirm.title')}
                </AppText>
              </View>
              <AppText variant="body">{describeCall(t, chat.pending.call, refs ?? {}, clients)}</AppText>
              <View style={styles.row}>
                <GlassButton
                  label={t('assistant:confirm.cancel')}
                  onPress={() => chat.decide(false)}
                  style={styles.flex}
                  testID="assistant-decline"
                />
                <GlassButton
                  label={t('assistant:confirm.run')}
                  variant="warning"
                  onPress={() => chat.decide(true)}
                  style={styles.flex}
                  testID="assistant-run"
                />
              </View>
            </GlassSurface>
          ) : null}
          {chat.error ? <ErrorCard error={chat.error} provider={providerName} /> : null}
        </ScrollView>

        <View
          style={[
            styles.inputBar,
            { paddingBottom: Math.max(insets.bottom, spacing.s), borderTopColor: colors.separator },
          ]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('assistant:placeholder')}
            placeholderTextColor={colors.textTertiary}
            multiline
            editable={consented || demo}
            style={[styles.input, { backgroundColor: colors.fill, color: colors.text }]}
            testID="assistant-input"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chat.busy ? t('assistant:stop') : t('assistant:send')}
            onPress={chat.busy ? chat.stop : () => submit()}
            disabled={!chat.busy && (!text.trim() || !(consented || demo))}
            style={[styles.send, { backgroundColor: chat.busy || text.trim() ? colors.accent : colors.fill }]}
            testID={chat.busy ? 'assistant-stop' : 'assistant-send'}>
            <Icon
              name={chat.busy ? 'stop' : 'send'}
              size={18}
              color={chat.busy || text.trim() ? colors.accentText : colors.textTertiary}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <RiskConfirm
        visible={confirmClear}
        level="medium"
        title={t('assistant:clearTitle')}
        consequences={[t('assistant:clearConsequence')]}
        confirmLabel={t('assistant:clear')}
        onConfirm={() => {
          setConfirmClear(false);
          chat.clear();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

function Message({
  message,
  results,
  pendingId,
}: {
  message: ChatMessage;
  results: Map<string, ToolResult>;
  pendingId?: string;
}) {
  const { colors } = useTheme();
  if (message.role === 'user') {
    if (!message.text) return null;
    return (
      <View style={[styles.bubble, styles.user, { backgroundColor: colors.accent }]}>
        <AppText variant="body" selectable style={{ color: colors.accentText }}>
          {message.text}
        </AppText>
      </View>
    );
  }
  return (
    <>
      {message.text ? (
        <View style={[styles.bubble, styles.assistant, { backgroundColor: colors.card }]}>
          <MarkdownText text={message.text} />
        </View>
      ) : null}
      {message.calls.map((c) => (
        <ToolChip key={c.id} call={c} result={results.get(c.id)} waiting={c.id === pendingId} />
      ))}
    </>
  );
}

function ToolChip({ call, result, waiting }: { call: ToolCall; result?: ToolResult; waiting: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const known = TOOLS.some((tool) => tool.name === call.name);
  const name = known ? t(`assistant:tool.names.${call.name as 'get_overview'}`) : call.name;
  const state = !result
    ? waiting
      ? null
      : 'running'
    : result.content === DECLINED
      ? 'declined'
      : result.isError
        ? 'failed'
        : 'done';
  if (!state) return null;
  const icon: IconName =
    state === 'done' ? 'check' : state === 'running' ? 'refresh' : state === 'declined' ? 'close' : 'warning';
  return (
    <View style={[styles.tool, { borderColor: colors.separator }]}>
      <Icon name={icon} size={14} color={state === 'failed' ? colors.warning : colors.textSecondary} />
      <AppText variant="caption" tone="secondary">
        {`${t(`assistant:tool.${state}`)} ${name}`}
      </AppText>
    </View>
  );
}

function Consent({ provider, onSettings }: { provider: string; onSettings(): void }) {
  const t = useT();
  const consent = useAssistant((s) => s.consent);
  return (
    <GlassSurface variant="card" style={styles.confirm}>
      <View style={styles.row}>
        <Icon name="shield" size={20} color="#0A84FF" />
        <AppText variant="headline">{t('assistant:consent.title')}</AppText>
      </View>
      <AppText variant="subhead">{t('assistant:consent.body', { provider })}</AppText>
      <AppText variant="subhead">{t('assistant:consent.privacy')}</AppText>
      <AppText variant="subhead">{t('assistant:consent.writes')}</AppText>
      <GlassButton
        label={t('assistant:consent.agree')}
        variant="primary"
        onPress={consent}
        testID="assistant-consent"
      />
      <GlassButton label={t('assistant:consent.openSettings')} onPress={onSettings} />
    </GlassSurface>
  );
}

function ErrorCard({ error, provider }: { error: ChatError; provider: string }) {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const settings = error.kind === 'no-key' || error.kind === 'auth' || error.kind === 'quota';
  return (
    <GlassSurface variant="card" style={styles.confirm}>
      <View style={styles.row}>
        <Icon name="warning" size={20} color={colors.warning} />
        <AppText variant="subhead" style={styles.flex}>
          {error.kind === 'no-key'
            ? t('assistant:noKey', { provider })
            : t(`assistant:error.${error.kind}`, { message: error.message })}
        </AppText>
      </View>
      {settings ? (
        <GlassButton label={t('assistant:openSettings')} onPress={() => nav.push('/more/assistant')} />
      ) : null}
    </GlassSurface>
  );
}

function BarButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} testID={testID}>
      <GlassSurface variant="pill" style={styles.barButton}>
        <Icon name={icon} size={20} color={colors.text} />
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  titleBox: { flex: 1, minWidth: 0 },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.l, gap: spacing.m },
  center: { textAlign: 'center' },
  empty: { gap: spacing.m, paddingTop: spacing.l },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  chip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  bubble: { borderRadius: 18, paddingHorizontal: spacing.m, paddingVertical: spacing.s + 2, maxWidth: '88%' },
  user: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  assistant: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  tool: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
  },
  confirm: { padding: spacing.l, gap: spacing.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: spacing.m,
    paddingVertical: 10,
    fontSize: 16,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
