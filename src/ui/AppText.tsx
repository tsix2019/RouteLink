import { Text, type TextProps } from 'react-native';

import { FONT_FAMILY } from './fonts';
import { useTheme } from './theme/ThemeProvider';
import { type } from './theme/tokens';

export type TextVariant = keyof typeof type;
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'success' | 'warning' | 'inverse';
export type FontWeight = '400' | '500' | '600' | '700';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: FontWeight;
  align?: 'left' | 'center' | 'right';
}

/** Font family + weight: the system font on iOS; one Inter face per weight elsewhere. */
export function fontFor(weight: FontWeight): { fontFamily?: string; fontWeight?: FontWeight } {
  const family = FONT_FAMILY[weight];
  return family ? { fontFamily: family } : { fontWeight: weight };
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
  const { fontWeight: baseWeight, ...base } = type[variant] as (typeof type)[TextVariant] & { fontWeight?: FontWeight };
  return (
    <Text
      style={[
        base,
        'fontFamily' in base ? null : fontFor(weight ?? baseWeight ?? '400'),
        { color },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
