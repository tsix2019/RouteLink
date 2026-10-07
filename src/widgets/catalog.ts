/**
 * Android's home-screen widgets (design §19), with the size (dp) the app previews them at. The names are the
 * AppWidgetProvider classes declared in app.config.ts (react-native-android-widget); `key` picks the texts
 * under `widget.kinds`.
 */
export const WIDGETS = [
  { name: 'RouterWidget', key: 'router', preview: { width: 170, height: 170 } },
  { name: 'SpeedWidget', key: 'speed', preview: { width: 200, height: 100 } },
  { name: 'DevicesWidget', key: 'devices', preview: { width: 290, height: 170 } },
  { name: 'SystemWidget', key: 'system', preview: { width: 170, height: 170 } },
  { name: 'WanWidget', key: 'wan', preview: { width: 200, height: 100 } },
  { name: 'ShortcutsWidget', key: 'shortcuts', preview: { width: 290, height: 100 } },
] as const;

export type WidgetKind = (typeof WIDGETS)[number];
export type WidgetName = WidgetKind['name'];
export type WidgetKey = WidgetKind['key'];

export const WIDGET_NAMES: readonly WidgetName[] = WIDGETS.map((w) => w.name);

export const isWidgetName = (name: string): name is WidgetName => (WIDGET_NAMES as readonly string[]).includes(name);

/** Where tapping a widget (outside its buttons) goes. */
export const WIDGET_LINKS: Record<WidgetName, string> = {
  RouterWidget: 'routelink://overview',
  SpeedWidget: 'routelink://overview',
  DevicesWidget: 'routelink://devices',
  SystemWidget: 'routelink://overview',
  WanWidget: 'routelink://network',
  ShortcutsWidget: 'routelink://overview',
};

/** The quick-actions widget's buttons. */
export const SHORTCUTS = [
  { key: 'wifiQr', icon: 'qr', uri: 'routelink://wifi-qr' },
  { key: 'devicesShortcut', icon: 'devices', uri: 'routelink://devices' },
  { key: 'terminal', icon: 'terminal', uri: 'routelink://terminal' },
  { key: 'assistant', icon: 'sparkles', uri: 'routelink://assistant' },
] as const;
