import SegmentedControl, { type SegmentedControlProps } from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

/** Rough text width at the control's font size (~13pt): CJK and other wide glyphs count double. */
function textWidth(label: string) {
  let w = 0;
  for (const ch of label) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 7.5;
  return w * PixelRatio.getFontScale();
}

/**
 * The segmented control in the app's own light or dark appearance. Left alone it follows the system
 * setting, so a phone in light mode drew white controls on the app's dark theme (and the reverse).
 *
 * The native control gives every segment an equal slice and cuts or wraps what does not fit. When a
 * label is too long for its slice, the options are shown as a stacked radio list instead.
 */
export function Segmented(props: SegmentedControlProps) {
  const { scheme } = useTheme();
  const [width, setWidth] = useState(0);
  const { values = [] } = props;
  const slice = width / Math.max(1, values.length);
  const overflow = width > 0 && values.some((v) => textWidth(String(v)) + 2 * spacing.m > slice);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {overflow ? <RadioList {...props} /> : <SegmentedControl appearance={scheme} {...props} />}
    </View>
  );
}

function RadioList({ values = [], selectedIndex, onChange, enabled = true, style }: SegmentedControlProps) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.list, { backgroundColor: colors.fill }, style]}>
      {values.map((value, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={`${index}-${value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: !enabled }}
            disabled={!enabled}
            onPress={() =>
              onChange?.({
                nativeEvent: { selectedSegmentIndex: index, value: String(value) },
              } as Parameters<NonNullable<SegmentedControlProps['onChange']>>[0])
            }
            style={[styles.option, selected && { backgroundColor: colors.accent }, !enabled && styles.disabled]}>
            <AppText
              variant="subhead"
              weight={selected ? '600' : '400'}
              style={[styles.label, { color: selected ? colors.accentText : colors.text }]}>
              {String(value)}
            </AppText>
            {selected ? <Icon name="check" size={18} color={colors.accentText} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, padding: 3, gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    minHeight: 44,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 13,
  },
  label: { flex: 1 },
  disabled: { opacity: 0.5 },
});
