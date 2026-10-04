import type { ColorValue, ViewProps } from 'react-native';

export interface GlassSurfaceProps extends ViewProps {
  /**
   * card: content cards and grouped lists — solid, like iOS 26 Settings.
   * floating: chrome over scrolling content (tab bar, sheets, toasts) — glass.
   * pill: capsule controls (bar buttons, router switcher) — glass.
   */
  variant?: 'card' | 'floating' | 'pill';
  /** iOS 26 interactive glass (press feedback). */
  interactive?: boolean;
  tint?: ColorValue;
  radius?: number;
}

export const defaultRadius = (variant: GlassSurfaceProps['variant']) => (variant === 'pill' ? 999 : 26);
