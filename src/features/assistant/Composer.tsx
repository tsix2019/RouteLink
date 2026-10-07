import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** The page behind the conversation: white in light mode, black in dark, as in the chat apps. */
export function usePageColor() {
  const { scheme, colors } = useTheme();
  return scheme === 'dark'
    ? { page: colors.background, clear: 'rgba(0,0,0,0)' }
    : { page: colors.card, clear: 'rgba(255,255,255,0)' };
}

/**
 * The message box, floating at the bottom with the conversation fading out behind it. The round button sends,
 * and turns into stop while an answer is coming.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  answering,
  editable,
}: {
  value: string;
  onChangeText(text: string): void;
  onSend(): void;
  onStop(): void;
  /** The open conversation's answer is coming: the button stops it. */
  answering: boolean;
  editable: boolean;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { page, clear } = usePageColor();
  const ready = editable && !!value.trim();
  const active = answering || ready;
  const scale = useSharedValue(active ? 1 : 0.88);

  useEffect(() => {
    scale.set(withSpring(active ? 1 : 0.88, { damping: 14, stiffness: 260 }));
  }, [active, scale]);
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const press = () => {
    if (answering) {
      void Haptics.selectionAsync();
      onStop();
    } else if (ready) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSend();
    }
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.s), backgroundColor: page }]}>
      <LinearGradient pointerEvents="none" colors={[clear, page]} style={styles.fade} />
      <View
        style={[
          styles.box,
          { backgroundColor: colors.card, borderColor: colors.separator, shadowColor: colors.shadow },
        ]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={t('assistant:placeholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={editable}
          style={[styles.input, { color: colors.text }]}
          testID="assistant-input"
        />
        <Animated.View style={buttonStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={answering ? t('assistant:stop') : t('assistant:send')}
            onPress={press}
            disabled={!active}
            hitSlop={6}
            style={[styles.send, { backgroundColor: active ? colors.accent : colors.fill }]}
            testID={answering ? 'assistant-stop' : 'assistant-send'}>
            <Animated.View
              key={answering ? 'stop' : 'send'}
              entering={ZoomIn.duration(160)}
              exiting={ZoomOut.duration(120)}>
              <Icon
                name={answering ? 'stop' : 'send'}
                size={answering ? 14 : 18}
                color={active ? colors.accentText : colors.textTertiary}
              />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.m, paddingTop: spacing.xs },
  fade: { position: 'absolute', left: 0, right: 0, top: -24, height: 24 },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing.l,
    paddingRight: 7,
    paddingVertical: 7,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 140,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 7,
    paddingBottom: 7,
    textAlignVertical: 'center',
  },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
