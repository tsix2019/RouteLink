import type { WidgetProps } from './props';

/** Platforms without a home-screen widget (and the tests): nothing to update. update.ios / update.android do. */
export async function showOnWidget(_props: WidgetProps): Promise<void> {}

/** Asks the launcher to add the widget (Android); elsewhere it can only be added from the home screen. */
export const pinWidget: (() => Promise<boolean>) | undefined = undefined;
