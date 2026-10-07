import type { WidgetName } from './catalog';
import type { WidgetData } from './data';

/** Platforms without a home-screen widget: nothing to update. update.ios / update.android do. */
export async function showOnWidget(_data: WidgetData): Promise<void> {}

/** What the widgets show now (Android keeps it for its previews). */
export const loadWidgetData = async (): Promise<WidgetData | null> => null;

/** Reads the router afresh for the widgets (Android's ↻). */
export async function refreshWidgets(): Promise<void> {}

/** Asks the launcher to add a widget (Android); elsewhere widgets can only be added from the home screen. */
export const pinWidget: ((name: WidgetName) => Promise<boolean>) | undefined = undefined;

export const countWidgets = async (_name: WidgetName): Promise<number> => 0;

export const hasWidgets = async (): Promise<boolean> => false;
