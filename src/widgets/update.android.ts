import Storage from 'expo-sqlite/kv-store';
import { requestPinWidget, requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { i18n } from '@/i18n';

import { emptyWidget, type WidgetProps } from './props';
import { renderRouterWidget } from './RouterWidget.android';

/** The last props, for redrawing when the launcher asks (added, resized) without the app running. */
const KEY = 'routelink.widget';
const NAME = 'RouterWidget';

export async function showOnWidget(props: WidgetProps): Promise<void> {
  await Storage.setItem(KEY, JSON.stringify(props));
  await requestWidgetUpdate({
    widgetName: NAME,
    renderWidget: (info) => renderRouterWidget(props, info.width),
    widgetNotFound: () => undefined,
  });
}

/** The launcher's own prompt for adding the widget; false when it has none. */
export const pinWidget: (() => Promise<boolean>) | undefined = () => requestPinWidget({ widgetName: NAME });

async function stored(): Promise<WidgetProps> {
  const text = await Storage.getItem(KEY);
  if (text) {
    try {
      return JSON.parse(text) as WidgetProps;
    } catch {
      // drawn empty below
    }
  }
  return emptyWidget(i18n.t.bind(i18n) as Parameters<typeof emptyWidget>[0]);
}

/** Registered in the entry file: the launcher calls it with no app on screen. */
export async function widgetTaskHandler(p: WidgetTaskHandlerProps): Promise<void> {
  if (p.widgetInfo.widgetName !== NAME) return;
  switch (p.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      p.renderWidget(renderRouterWidget(await stored(), p.widgetInfo.width));
      break;
    default:
      break;
  }
}
