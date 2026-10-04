import { Text, type TextProps } from 'react-native';

import { useTheme } from './theme/ThemeProvider';
import { type } from './theme/tokens';

export type TextVariant = keyof typeof type;
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'success' | 'warning' | 'inverse';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: '400' | '500' | '600' | '700';
  align?: 'left' | 'center' | 'right';
}

export function AppText({ variant = 'body', tone = 'primary', weight, align, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const color = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
    inverse: colors.accentText,
  }[tone];
  return (
    <Text
      style={[
        type[variant],
        { color },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
