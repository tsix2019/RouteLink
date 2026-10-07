import Storage from 'expo-sqlite/kv-store';
import {
  getWidgetInfo,
  requestPinWidget,
  requestWidgetUpdate,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';

import { currentLanguage, i18n, type AppT } from '@/i18n';

import { REFRESH, renderWidget } from './android/widgets';
import { isWidgetName, WIDGET_NAMES, type WidgetName } from './catalog';
import type { WidgetData } from './data';
import { prepareHeadless, readForWidgets } from './refresh';
import { widgetView, type WidgetView } from './view';

/** The last data, for redrawing when the launcher asks (added, resized, every 30 minutes) with no app open. */
const KEY = 'routelink.widget.data';
/** Older than this, a widget being added or the launcher's periodic update reads the router again. */
const STALE_MS = 10 * 60_000;

const view = (data: WidgetData | null, refreshing = false): WidgetView =>
  widgetView(i18n.t.bind(i18n) as AppT, currentLanguage(), data, { refreshing });

/** What the widgets show now (the app's previews of them). */
export async function loadWidgetData(): Promise<WidgetData | null> {
  return stored();
}

async function stored(): Promise<WidgetData | null> {
  const text = await Storage.getItem(KEY);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as WidgetData;
    return typeof data.updatedAt === 'number' ? data : null;
  } catch {
    return null;
  }
}

async function drawAll(v: WidgetView): Promise<void> {
  await Promise.all(
    WIDGET_NAMES.map((name) =>
      requestWidgetUpdate({
        widgetName: name,
        renderWidget: (info) => renderWidget(name, v, info.width, info.height),
        widgetNotFound: () => undefined,
      }),
    ),
  );
}

export async function showOnWidget(data: WidgetData): Promise<void> {
  await Storage.setItem(KEY, JSON.stringify(data));
  await drawAll(view(data));
}

let refreshing: Promise<void> | null = null;

/** ↻: "Refreshing…" on every widget, then what the router says (or the old data again, if it said nothing). */
export function refreshWidgets(): Promise<void> {
  refreshing ??= (async () => {
    try {
      await prepareHeadless();
      const previous = await stored();
      await drawAll(view(previous, true));
      const fresh = await readForWidgets().catch(() => null);
      if (fresh) await showOnWidget(fresh);
      else await drawAll(view(previous));
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** The launcher's own prompt for adding a widget; false when it has none. */
export const pinWidget: ((name: WidgetName) => Promise<boolean>) | undefined = (name) =>
  requestPinWidget({ widgetName: name });

/** How many of this widget are on the home screen. */
export const countWidgets = async (name: WidgetName): Promise<number> => (await getWidgetInfo(name)).length;

export async function hasWidgets(): Promise<boolean> {
  const counts = await Promise.all(WIDGET_NAMES.map(countWidgets));
  return counts.some((n) => n > 0);
}

/** Registered in the entry file: the launcher calls it with no app on screen. */
export async function widgetTaskHandler(p: WidgetTaskHandlerProps): Promise<void> {
  const name = p.widgetInfo.widgetName;
  if (!isWidgetName(name)) return;
  switch (p.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      await prepareHeadless();
      const data = await stored();
      p.renderWidget(renderWidget(name, view(data), p.widgetInfo.width, p.widgetInfo.height));
      // A new widget, or the launcher's half-hourly update, gets fresh data when it can.
      const stale = !data || Date.now() - data.updatedAt > STALE_MS;
      if (p.widgetAction !== 'WIDGET_RESIZED' && name !== 'ShortcutsWidget' && stale && data?.refreshable !== false) {
        await refreshWidgets();
      }
      break;
    }
    case 'WIDGET_CLICK':
      if (p.clickAction === REFRESH) await refreshWidgets();
      break;
    default:
      break;
  }
}
