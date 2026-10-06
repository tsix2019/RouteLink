import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';

import type { TerminalKey } from './html';

type Item =
  | { kind: 'key'; key: TerminalKey; label: string }
  | { kind: 'ctrl' }
  | { kind: 'text'; text: string }
  | { kind: 'paste' }
  | { kind: 'copy' };

const ITEMS: Item[] = [
  { kind: 'key', key: 'esc', label: 'Esc' },
  { kind: 'key', key: 'tab', label: 'Tab' },
  { kind: 'ctrl' },
  { kind: 'key', key: 'up', label: '↑' },
  { kind: 'key', key: 'down', label: '↓' },
  { kind: 'key', key: 'left', label: '←' },
  { kind: 'key', key: 'right', label: '→' },
  { kind: 'text', text: '|' },
  { kind: 'text', text: '/' },
  { kind: 'text', text: '-' },
  { kind: 'text', text: '~' },
  { kind: 'key', key: 'home', label: 'Home' },
  { kind: 'key', key: 'end', label: 'End' },
  { kind: 'paste' },
  { kind: 'copy' },
];

interface Props {
  /** Ctrl is latched until the next key. */
  ctrl: boolean;
  onCtrl(on: boolean): void;
  onKey(key: TerminalKey): void;
  onText(text: string): void;
  onPaste(): void;
  onCopy(): void;
  pasteLabel: string;
  copyLabel: string;
}

/** The row above the keyboard (design §17): keys a phone keyboard lacks. */
export function KeyBar({ ctrl, onCtrl, onKey, onText, onPaste, onCopy, pasteLabel, copyLabel }: Props) {
  const { colors } = useTheme();
  const press = (item: Item) => {
    void Haptics.selectionAsync();
    switch (item.kind) {
      case 'key':
        return onKey(item.key);
      case 'ctrl':
        return onCtrl(!ctrl);
      case 'text':
        return onText(item.text);
      case 'paste':
        return onPaste();
      case 'copy':
        return onCopy();
    }
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.separator }]}
      contentContainerStyle={styles.row}>
      {ITEMS.map((item, i) => {
        const active = item.kind === 'ctrl' && ctrl;
        const label =
          item.kind === 'key' ? item.label : item.kind === 'text' ? item.text : item.kind === 'ctrl' ? 'Ctrl' : null;
        return (
          <Pressable
            key={i}
            onPress={() => press(item)}
            accessibilityRole="button"
            accessibilityLabel={item.kind === 'paste' ? pasteLabel : item.kind === 'copy' ? copyLabel : (label ?? '')}
            accessibilityState={item.kind === 'ctrl' ? { selected: ctrl } : undefined}
            testID={`key-${item.kind === 'key' ? item.key : item.kind === 'text' ? item.text : item.kind}`}
            style={({ pressed }) => [
              styles.cap,
              { backgroundColor: active ? colors.accent : pressed ? colors.fill : colors.background },
            ]}>
            {label !== null ? (
              <AppText variant="subhead" style={[styles.label, { color: active ? colors.accentText : colors.text }]}>
                {label}
              </AppText>
            ) : (
              <Icon name={item.kind === 'paste' ? 'paste' : 'copy'} size={18} color={colors.text} />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: spacing.s, paddingVertical: 6, gap: 6, alignItems: 'center' },
  cap: {
    minWidth: 40,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: MONO_FONT },
});
