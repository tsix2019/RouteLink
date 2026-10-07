import type { ReactElement } from 'react';

import { i18n, initI18n } from '@/i18n';

import { WIDGETS } from '../catalog';
import { sampleWidgetData } from '../sample';
import { widgetView } from '../view';
import { REFRESH, renderWidget } from './widgets';

initI18n('system');
const t = i18n.getFixedT('zh-CN') as unknown as Parameters<typeof widgetView>[0];

interface Tree {
  type: string;
  props: Record<string, unknown>;
  children?: Tree[];
}

// The library's own tree builder (not exported from its index): what the launcher draws from, so a widget
// that cannot be built fails here.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- untyped file of the published build
const { buildWidgetTree } = require('react-native-android-widget/lib/commonjs/api/build-widget-tree') as {
  buildWidgetTree(element: ReactElement): Tree;
};

const flatten = (tree: Tree): Tree[] => [tree, ...(tree.children ?? []).flatMap(flatten)];
const texts = (tree: Tree) => flatten(tree).flatMap((n) => (n.type === 'TextWidget' ? [n.props.text as string] : []));
const actions = (tree: Tree) => flatten(tree).flatMap((n) => (n.props.clickAction ? [n.props.clickAction] : []));

const SIZES = [
  [110, 40],
  [180, 103],
  [170, 170],
  [290, 170],
  [380, 260],
];

describe('Android widgets', () => {
  const now = new Date(2026, 9, 6, 9, 41).getTime();
  const views = {
    online: widgetView(t, 'zh-CN', sampleWidgetData(now)),
    offline: widgetView(t, 'zh-CN', { ...sampleWidgetData(now), online: false }),
    empty: widgetView(t, 'zh-CN', null),
    refreshing: widgetView(t, 'zh-CN', sampleWidgetData(now), { refreshing: true }),
    noPassword: widgetView(t, 'zh-CN', { ...sampleWidgetData(now), refreshable: false }),
  };

  it.each(WIDGETS.map((w) => w.name))('%s can be drawn at every size, in every state, light and dark', (name) => {
    for (const [width, height] of SIZES) {
      for (const v of Object.values(views)) {
        const { light, dark } = renderWidget(name, v, width, height);
        expect(() => buildWidgetTree(light)).not.toThrow();
        expect(() => buildWidgetTree(dark)).not.toThrow();
      }
    }
  });

  it('says what it shows, and ↻ reads the router only when the password is saved', () => {
    const tree = buildWidgetTree(renderWidget('SpeedWidget', views.online, 250, 170).light);
    expect(texts(tree)).toEqual(expect.arrayContaining(['34.7 Mbps', '6.4 Mbps', '更新于 09:41']));
    expect(actions(tree)).toContain(REFRESH);
    const locked = buildWidgetTree(renderWidget('SpeedWidget', views.noPassword, 250, 170).light);
    expect(actions(locked)).not.toContain(REFRESH);
    const offline = buildWidgetTree(renderWidget('SpeedWidget', views.offline, 180, 80).light);
    expect(texts(offline)).toContain('连不上');
  });

  it('fits as many shortcuts as the width allows', () => {
    const count = (width: number) =>
      flatten(buildWidgetTree(renderWidget('ShortcutsWidget', views.online, width, 90).light)).filter(
        (n) => n.props.clickAction === 'OPEN_URI',
      ).length;
    // The card itself opens the overview; one more per button.
    expect(count(290)).toBe(1 + 4);
    expect(count(150)).toBe(1 + 2);
  });
});
