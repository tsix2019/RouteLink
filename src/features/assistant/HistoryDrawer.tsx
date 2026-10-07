import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { useLang, useT } from '@/i18n';
import { useAssistant, type Conversation } from '@/state/assistant';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { PromptSheet } from '@/ui/PromptSheet';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatClock, formatDay } from '@/utils/dates';

import { groupHistory, sectionOf } from './history';

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;

function when(time: number, now: number, lang: 'zh-CN' | 'en') {
  const section = sectionOf(time, now);
  const sec = Math.floor(time / 1000);
  if (section === 'today') return formatClock(sec);
  return formatDay(sec, lang, { year: new Date(time).getFullYear() !== new Date(now).getFullYear() });
}

/**
 * The router's conversations, sliding in from the left like the chat apps' sidebars: search, a new chat, the
 * conversations by date; long press renames or deletes one. Swipe it back or tap outside to close.
 */
export function HistoryDrawer({
  visible,
  now,
  progress,
  routerId,
  routerName,
  currentId,
  onClose,
  onOpen,
  onNew,
  onSettings,
}: {
  visible: boolean;
  /** When it opened: the dates are read against it, so they stay put while it is open. */
  now: number;
  /** 0 closed, 1 open; the screen behind follows it. */
  progress: SharedValue<number>;
  routerId: string | undefined;
  routerName: string;
  currentId: string | undefined;
  onClose(): void;
  onOpen(id: string): void;
  onNew(): void;
  onSettings(): void;
}) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { scheme, colors } = useTheme();
  const panel = Math.min(Math.round(width * 0.84), 360);
  const conversations = useAssistant(
    useShallow((s) => Object.values(s.conversations).filter((c) => c.routerId === routerId)),
  );
  const rename = useAssistant((s) => s.rename);
  const remove = useAssistant((s) => s.remove);
  const [query, setQuery] = useState('');
  const [acting, setActing] = useState<Conversation | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const groups = useMemo(() => groupHistory(conversations, now, query), [conversations, now, query]);

  useEffect(() => {
    progress.set(visible ? withSpring(1, SPRING) : withTiming(0, { duration: 220 }));
  }, [visible, progress]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const drag = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onChange((e) => progress.set(Math.min(1, Math.max(0, progress.get() + e.changeX / panel))))
    .onEnd((e) => {
      if (progress.get() < 0.65 || e.velocityX < -500) runOnJS(onClose)();
      else progress.set(withSpring(1, SPRING));
    });

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [-panel - 24, 0]) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  return (
    <>
      {/* Closed, it waits off screen: out of reach of touches and of screen readers. */}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={visible ? 'auto' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('cancel')} />
        </Animated.View>
        <GestureDetector gesture={drag}>
          <Animated.View
            style={[
              styles.panel,
              {
                width: panel,
                paddingTop: insets.top + spacing.s,
                paddingBottom: Math.max(insets.bottom, spacing.m),
                backgroundColor: scheme === 'dark' ? colors.card : colors.background,
                shadowColor: colors.shadow,
              },
              panelStyle,
            ]}
            accessibilityViewIsModal={visible}
            testID="assistant-history">
            <View style={styles.head}>
              <AppText variant="title">{t('assistant:history.title')}</AppText>
              <AppText variant="footnote" tone="secondary" numberOfLines={1}>
                {routerName}
              </AppText>
            </View>

            <View style={[styles.search, { backgroundColor: colors.fill }]}>
              <Icon name="search" size={16} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('assistant:history.search')}
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
                autoCorrect={false}
                style={[styles.searchInput, { color: colors.text }]}
                testID="assistant-history-search"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={t('cancel')}>
                  <Icon name="close" size={14} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={onNew}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, styles.newRow, pressed && { backgroundColor: colors.fill }]}
              testID="assistant-history-new">
              <Icon name="compose" size={18} color={colors.accent} />
              <AppText variant="body" weight="500" style={{ color: colors.accent }}>
                {t('assistant:newChat')}
              </AppText>
            </Pressable>

            <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
              {groups.length === 0 ? (
                <AppText variant="footnote" tone="secondary" style={styles.empty}>
                  {query.trim() ? t('assistant:history.noMatch') : t('assistant:history.empty')}
                </AppText>
              ) : null}
              {groups.map((g) => (
                <View key={g.section} style={styles.group}>
                  <AppText variant="caption" weight="600" tone="secondary" style={styles.section}>
                    {t(`assistant:history.${g.section}`)}
                  </AppText>
                  {g.items.map((c) => {
                    const selected = c.id === currentId;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => onOpen(c.id)}
                        onLongPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          setActing(c);
                        }}
                        delayLongPress={350}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [styles.row, (selected || pressed) && { backgroundColor: colors.fill }]}
                        testID={`assistant-history-${c.id}`}>
                        <AppText
                          variant="subhead"
                          weight={selected ? '600' : undefined}
                          numberOfLines={1}
                          style={styles.flex}>
                          {c.title || t('assistant:newChat')}
                        </AppText>
                        <AppText variant="caption" tone="tertiary">
                          {when(c.updatedAt, now, lang)}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={[styles.foot, { borderTopColor: colors.separator }]}>
              <Pressable
                onPress={onSettings}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill }]}>
                <Icon name="settings" size={18} color={colors.textSecondary} />
                <AppText variant="subhead">{t('assistant:settings')}</AppText>
              </Pressable>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      <ActionSheet
        visible={!!acting}
        title={acting?.title}
        actions={[
          {
            label: t('assistant:history.rename'),
            icon: 'edit',
            onPress: () => {
              setRenaming(acting);
              setActing(null);
            },
          },
          {
            label: t('assistant:history.delete'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              if (acting) {
                if (acting.id === currentId) onNew();
                remove(acting.id);
                toast(t('assistant:history.deleted'));
              }
              setActing(null);
            },
          },
        ]}
        onCancel={() => setActing(null)}
      />
      <PromptSheet
        visible={!!renaming}
        title={t('assistant:history.renameTitle')}
        initialValue={renaming?.title}
        confirmLabel={t('save')}
        validate={(value) => (value.trim() ? undefined : t('assistant:history.renameRequired'))}
        onSubmit={(value) => {
          if (renaming) rename(renaming.id, value);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.32)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 6, height: 0 },
    elevation: 16,
    overflow: 'hidden',
  },
  head: { paddingHorizontal: spacing.l + 4, paddingVertical: spacing.s, gap: 2 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginHorizontal: spacing.l,
    marginTop: spacing.s,
    paddingHorizontal: spacing.m,
    height: 38,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    minHeight: 44,
    paddingHorizontal: spacing.m,
    marginHorizontal: spacing.s,
    borderRadius: 12,
  },
  newRow: { marginTop: spacing.s },
  list: { paddingBottom: spacing.l, paddingTop: spacing.xs },
  group: { marginTop: spacing.s },
  section: { paddingHorizontal: spacing.l + 4, paddingVertical: spacing.xs, textTransform: 'uppercase' },
  empty: { paddingHorizontal: spacing.l + 4, paddingTop: spacing.l },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.s },
});
