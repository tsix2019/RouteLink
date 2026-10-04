import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { radius, spacing } from './theme/tokens';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  /** Password field with a show/hide toggle. */
  secret?: boolean;
  monospace?: boolean;
}

export function TextField({ label, error, hint, secret, monospace, style, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="footnote" tone="secondary">
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.field,
          { backgroundColor: colors.glassFill, borderColor: error ? colors.danger : colors.glassBorder },
        ]}>
        <TextInput
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secret && !visible}
          style={[styles.input, { color: colors.text }, monospace && styles.mono, style]}
          {...rest}
        />
        {secret ? (
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'hide' : 'show'} onPress={() => setVisible((v) => !v)} hitSlop={10}>
            <Icon name={visible ? 'eyeOff' : 'eye'} size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error || hint ? (
        <AppText variant="footnote" tone={error ? 'danger' : 'tertiary'}>
          {error ?? hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    borderRadius: radius.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.m,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 17, paddingVertical: spacing.s },
  mono: { fontFamily: 'monospace', fontSize: 15 },
});
