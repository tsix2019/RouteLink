import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';

import { parseMarkdown, type Inline } from './markdown';

function Spans({ inline }: { inline: Inline[] }) {
  const { colors } = useTheme();
  return inline.map((s, i) => (
    <AppText
      key={i}
      variant="body"
      style={[s.bold && styles.bold, s.code && [styles.code, { backgroundColor: colors.fill }]]}>
      {s.text}
    </AppText>
  ));
}

/** An answer as the AI wrote it: paragraphs, headings, lists, code. */
export function MarkdownText({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.blocks}>
      {parseMarkdown(text).map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <AppText key={i} variant="headline" selectable>
                <Spans inline={b.inline} />
              </AppText>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.item}>
                    <AppText variant="body" style={styles.marker}>
                      {b.ordered ? `${j + 1}.` : '•'}
                    </AppText>
                    <AppText variant="body" selectable style={styles.flex}>
                      <Spans inline={item} />
                    </AppText>
                  </View>
                ))}
              </View>
            );
          case 'code':
            return (
              <View key={i} style={[styles.codeBlock, { backgroundColor: colors.fill }]}>
                <AppText variant="footnote" selectable style={styles.mono}>
                  {b.text}
                </AppText>
              </View>
            );
          default:
            return (
              <AppText key={i} variant="body" selectable>
                <Spans inline={b.inline} />
              </AppText>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: spacing.s },
  bold: { fontWeight: '700' },
  code: { fontFamily: MONO_FONT, fontSize: 14 },
  list: { gap: 2 },
  item: { flexDirection: 'row', gap: 6 },
  marker: { minWidth: 14 },
  flex: { flex: 1 },
  codeBlock: { borderRadius: 10, padding: spacing.s },
  mono: { fontFamily: MONO_FONT },
});
