/** Colours of the Android widgets, after the app's own (src/ui/theme/tokens.ts). */
export interface Palette {
  background: `#${string}`;
  text: `#${string}`;
  secondary: `#${string}`;
  tertiary: `#${string}`;
  track: `#${string}`;
  button: `#${string}`;
  accent: `#${string}`;
  green: `#${string}`;
  orange: `#${string}`;
  red: `#${string}`;
  down: `#${string}`;
  up: `#${string}`;
}

export const palette = (dark: boolean): Palette =>
  dark
    ? {
        background: '#1C1C1EF0',
        text: '#FFFFFF',
        secondary: '#AEAEB2',
        tertiary: '#8E8E93',
        track: '#3A3A3C',
        button: '#2C2C2E',
        accent: '#0A84FF',
        green: '#30D158',
        orange: '#FF9F0A',
        red: '#FF453A',
        down: '#0A84FF',
        up: '#40C8E0',
      }
    : {
        background: '#FFFFFFF0',
        text: '#1C1C1E',
        secondary: '#6C6C70',
        tertiary: '#8E8E93',
        track: '#E5E5EA',
        button: '#F2F2F7',
        accent: '#007AFF',
        green: '#34C759',
        orange: '#FF9500',
        red: '#FF3B30',
        down: '#007AFF',
        up: '#30B0C7',
      };

/** Bars turn orange, then red, as they fill. */
export const loadColor = (p: Palette, ratio: number) => (ratio >= 0.9 ? p.red : ratio >= 0.7 ? p.orange : p.accent);

const PATHS = {
  refresh:
    '<polyline points="23 4 23 10 17 10" fill="none"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" fill="none"/>',
  down: '<line x1="12" y1="4" x2="12" y2="20"/><polyline points="18 14 12 20 6 14" fill="none"/>',
  up: '<line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10" fill="none"/>',
  qr:
    '<rect x="3" y="3" width="7" height="7" rx="1" fill="none"/><rect x="14" y="3" width="7" height="7" rx="1" fill="none"/>' +
    '<rect x="3" y="14" width="7" height="7" rx="1" fill="none"/><line x1="14" y1="14" x2="14" y2="14.01"/>' +
    '<line x1="21" y1="14" x2="21" y2="14.01"/><line x1="17.5" y1="17.5" x2="17.5" y2="17.51"/>' +
    '<line x1="14" y1="21" x2="14" y2="21.01"/><line x1="21" y1="21" x2="21" y2="21.01"/>',
  devices:
    '<rect x="2" y="4" width="15" height="11" rx="1.5" fill="none"/><line x1="6" y1="19" x2="13" y2="19"/>' +
    '<rect x="16" y="9" width="6" height="11" rx="1.5" fill="none"/>',
  terminal: '<polyline points="4 17 10 11 4 5" fill="none"/><line x1="12" y1="19" x2="20" y2="19"/>',
  sparkles:
    '<path d="M10 5 L11.9 11.1 L18 13 L11.9 14.9 L10 21 L8.1 14.9 L2 13 L8.1 11.1 Z"/>' +
    '<path d="M18 2 L18.9 5.1 L22 6 L18.9 6.9 L18 10 L17.1 6.9 L14 6 L17.1 5.1 Z"/>',
} as const;

export type WidgetIcon = keyof typeof PATHS;

/** A 24×24 line icon as an SVG string (SvgWidget), in one colour. */
export function icon(name: WidgetIcon, color: string): string {
  const filled = name === 'sparkles';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" ` +
    `fill="${filled ? color.slice(0, 7) : 'none'}" stroke="${color.slice(0, 7)}" stroke-width="${filled ? 1 : 2}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`
  );
}
