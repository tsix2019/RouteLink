export type Scheme = 'light' | 'dark';

export interface Palette {
  /** Background gradient stops (top-left → bottom-right) and the colour blobs floating over it. */
  background: readonly [string, string, string];
  blobs: readonly [string, string, string];
  text: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  /** Glass emulation (Android, pre-iOS 26). */
  glassFill: string;
  glassFillStrong: string;
  glassBorder: string;
  glassHighlight: string;
  shadow: string;
  /** Series colours for charts: download, upload. */
  chartDown: string;
  chartUp: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    background: ['#EAF1FF', '#F4ECFF', '#E6FAF3'],
    blobs: ['rgba(10,132,255,0.28)', 'rgba(175,82,222,0.20)', 'rgba(48,209,88,0.18)'],
    text: '#0B1220',
    textSecondary: 'rgba(11,18,32,0.62)',
    textTertiary: 'rgba(11,18,32,0.38)',
    separator: 'rgba(11,18,32,0.10)',
    accent: '#0A84FF',
    accentText: '#FFFFFF',
    success: '#30B350',
    warning: '#E68A00',
    danger: '#FF3B30',
    glassFill: 'rgba(255,255,255,0.55)',
    glassFillStrong: 'rgba(255,255,255,0.78)',
    glassBorder: 'rgba(255,255,255,0.75)',
    glassHighlight: 'rgba(255,255,255,0.65)',
    shadow: 'rgba(31,45,90,0.16)',
    chartDown: '#0A84FF',
    chartUp: '#14C8C8',
  },
  dark: {
    background: ['#0A0F1E', '#171033', '#06191A'],
    blobs: ['rgba(10,132,255,0.32)', 'rgba(175,82,222,0.24)', 'rgba(20,200,200,0.18)'],
    text: '#F2F5FF',
    textSecondary: 'rgba(242,245,255,0.64)',
    textTertiary: 'rgba(242,245,255,0.40)',
    separator: 'rgba(242,245,255,0.12)',
    accent: '#0A84FF',
    accentText: '#FFFFFF',
    success: '#30D158',
    warning: '#FF9F0A',
    danger: '#FF453A',
    glassFill: 'rgba(28,30,44,0.55)',
    glassFillStrong: 'rgba(28,30,44,0.80)',
    glassBorder: 'rgba(255,255,255,0.14)',
    glassHighlight: 'rgba(255,255,255,0.10)',
    shadow: 'rgba(0,0,0,0.45)',
    chartDown: '#409CFF',
    chartUp: '#3DE0D4',
  },
};

export const radius = { card: 24, button: 16, field: 14, pill: 999 } as const;
export const spacing = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 0.35 },
  headline: { fontSize: 17, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, fontWeight: '400', letterSpacing: -0.41 },
  subhead: { fontSize: 15, fontWeight: '400', letterSpacing: -0.24 },
  footnote: { fontSize: 13, fontWeight: '400', letterSpacing: -0.08 },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0 },
  mono: { fontSize: 13, fontFamily: 'monospace' },
} as const;
