import type { WidgetProps } from './props';

/** Platforms without a home-screen widget (and the tests): nothing to update. update.ios / update.android do. */
export async function showOnWidget(_props: WidgetProps): Promise<void> {}
