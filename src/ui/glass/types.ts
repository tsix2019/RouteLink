import type { ColorValue, ViewProps } from 'react-native';

export interface GlassSurfaceProps extends ViewProps {
  /**
   * card: content cards (Android draws them without blur: they sit on a smooth background).
   * floating: surfaces over scrolling content (tab bar, sheets) — real blur on Android 12+.
   * pill: capsule controls.
   */
  variant?: 'card' | 'floating' | 'pill';
  /** iOS 26 interactive glass (press feedback). */
  interactive?: boolean;
  tint?: ColorValue;
  radius?: number;
}

export const defaultRadius = (variant: GlassSurfaceProps['variant']) => (variant === 'pill' ? 999 : 24);
