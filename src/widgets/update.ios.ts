import type { WidgetProps } from './props';
import RouterWidget from './RouterWidget.ios';

/** Pushes the props to the widget (app group) and asks WidgetKit to redraw it. */
export async function showOnWidget(props: WidgetProps): Promise<void> {
  RouterWidget.updateSnapshot(props);
}

/** iOS widgets are added from the home screen only. */
export const pinWidget: (() => Promise<boolean>) | undefined = undefined;
