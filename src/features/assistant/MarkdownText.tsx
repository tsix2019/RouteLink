import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { AppText, fontFor } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

import { parseMarkdown, type Inline, type MdBlock } from './markdown';

/** A blinking dot after the last word while the answer streams in. */
function Caret() {
  const { colors } = useTheme();
  const [on, setOn] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(timer);
  }, []);
  return <Text style={{ color: on ? colors.accent : 'transparent' }}>{' ●'}</Text>;
}

function Spans({ inline, caret }: { inline: Inline[]; caret?: boolean }) {
  const { colors } = useTheme();
  return (
    <>
      {inline.map((s, i) => (
        <Text key={i} style={[s.bold && fontFor('600'), s.code && [styles.code, { backgroundColor: colors.fill }]]}>
          {s.text}
        </Text>
      ))}
      {caret ? <Caret /> : null}
    </>
  );
}

/** Rough width of a cell's text in table units (CJK counts double), to size the columns alike in every row. */
const units = (cell: Inline[]) => {
  let n = 0;
  for (const s of cell) for (const ch of s.text) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return n;
};

function Table({ block }: { block: Extract<MdBlock, { kind: 'table' }> }) {
  const { colors } = useTheme();
  const columns = Math.max(block.header.length, ...block.rows.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.min(200, Math.max(64, Math.max(...[block.header, ...block.rows].map((r) => units(r[c] ?? []))) * 7.5 + 24)),
  );
  const row = (cells: Inline[][], header: boolean, key: number) => (
    <View
      key={key}
      style={[
        styles.tableRow,
        { borderTopColor: colors.separator, borderTopWidth: key === 0 ? 0 : StyleSheet.hairlineWidth },
        header && { backgroundColor: colors.fill },
      ]}>
      {widths.map((width, c) => (
        <AppText
          key={c}
          variant="footnote"
          weight={header ? '600' : undefined}
          selectable
          style={[styles.cell, { width }]}>
          <Spans inline={cells[c] ?? []} />
        </AppText>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={[styles.table, { borderColor: colors.separator }]}>
        {row(block.header, true, 0)}
        {block.rows.map((r, i) => row(r, false, i + 1))}
      </View>
    </ScrollView>
  );
}

function CodeBlock({ text }: { text: string }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const copy = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void Clipboard.setStringAsync(text).then(() => toast(t('assistant:copied')));
  };
  return (
    <View style={[styles.codeBlock, { backgroundColor: colors.fill }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <AppText variant="mono" selectable style={styles.codeText}>
          {text}
        </AppText>
      </ScrollView>
      <Pressable
        onPress={copy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('assistant:copy')}
        style={styles.codeCopy}>
        <Icon name="copy" size={15} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

/** An answer as the AI wrote it: paragraphs, headings, lists, quotes, tables, code. Full width, never in a bubble. */
export function MarkdownText({ text, caret }: { text: string; caret?: boolean }) {
  const { colors } = useTheme();
  const blocks = parseMarkdown(text);
  const last = blocks.length - 1;
  // The caret follows the last word when the answer ends in text; after a table or code it gets its own line.
  const inlineCaret = caret && ['paragraph', 'heading', 'list', 'quote'].includes(blocks[last]?.kind ?? '');
  return (
    <View style={styles.blocks}>
      {blocks.map((b, i) => {
        const tail = inlineCaret && i === last;
        switch (b.kind) {
          case 'heading':
            return (
              <AppText key={i} variant="body" weight="700" selectable style={b.level <= 2 ? styles.h1 : styles.h3}>
                <Spans inline={b.inline} caret={tail} />
              </AppText>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.item}>
                    <AppText variant="body" tone="secondary" style={[styles.body, styles.marker]}>
                      {b.ordered ? `${b.start + j}.` : '•'}
                    </AppText>
                    <AppText variant="body" selectable style={[styles.body, styles.flex]}>
                      <Spans inline={item} caret={tail && j === b.items.length - 1} />
                    </AppText>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={[styles.quote, { borderLeftColor: colors.separator }]}>
                <AppText variant="body" tone="secondary" selectable style={styles.body}>
                  <Spans inline={b.inline} caret={tail} />
                </AppText>
              </View>
            );
          case 'table':
            return <Table key={i} block={b} />;
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: colors.separator }]} />;
          case 'code':
            return <CodeBlock key={i} text={b.text} />;
          default:
            return (
              <AppText key={i} variant="body" selectable style={styles.body}>
                <Spans inline={b.inline} caret={tail} />
              </AppText>
            );
        }
      })}
      {caret && !inlineCaret ? (
        <AppText variant="body" style={styles.body}>
          <Caret />
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: spacing.m, alignSelf: 'stretch' },
  // Chinese reads better untracked and with room between lines; an explicit line height also keeps Android's
  // measurement of mixed Latin/CJK text honest.
  body: { fontSize: 16, lineHeight: 25, letterSpacing: 0 },
  h1: { fontSize: 19, lineHeight: 27, letterSpacing: 0 },
  h3: { fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  code: { fontFamily: MONO_FONT, fontSize: 14 },
  list: { gap: spacing.xs },
  item: { flexDirection: 'row', gap: spacing.s },
  marker: { minWidth: 16 },
  flex: { flex: 1 },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.m },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  codeBlock: { borderRadius: 12 },
  codeScroll: { padding: spacing.m, paddingRight: 40 },
  codeText: { lineHeight: 19 },
  codeCopy: { position: 'absolute', top: 8, right: 8, padding: 4 },
  tableScroll: { marginHorizontal: -2 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden', marginHorizontal: 2 },
  tableRow: { flexDirection: 'row' },
  cell: { paddingHorizontal: 10, paddingVertical: 8, lineHeight: 19 },
});
