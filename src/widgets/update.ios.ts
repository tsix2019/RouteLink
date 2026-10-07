import { i18n, type AppT } from '@/i18n';

import type { WidgetName } from './catalog';
import type { WidgetData } from './data';
import { widgetProps } from './props';
import RouterWidget from './RouterWidget.ios';

/** Pushes the texts to the widget (app group) and asks WidgetKit to redraw it. */
export async function showOnWidget(data: WidgetData): Promise<void> {
  RouterWidget.updateSnapshot(widgetProps(i18n.t.bind(i18n) as AppT, data));
}

/** WidgetKit keeps the data to itself. */
export const loadWidgetData = async (): Promise<WidgetData | null> => null;

/** iOS widgets have no buttons of their own. */
export async function refreshWidgets(): Promise<void> {}

/** iOS widgets are added from the home screen only. */
export const pinWidget: ((name: WidgetName) => Promise<boolean>) | undefined = undefined;

/** WidgetKit does not say which widgets are on the home screen. */
export const countWidgets = async (_name: WidgetName): Promise<number> => 0;

/** Unknown: assume there is one, so the background check keeps it fresh. */
export const hasWidgets = async (): Promise<boolean> => true;
