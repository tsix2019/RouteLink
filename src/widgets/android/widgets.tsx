'use no memo';
// The React Compiler would add hooks; widgets are drawn outside React's renderer, where hooks fail.
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { SHORTCUTS, WIDGET_LINKS, type WidgetName } from '../catalog';
import type { Gauge, WidgetView } from '../view';
import { icon, loadColor, palette, type Palette } from './theme';

/** clickAction of ↻: the task handler reads the router again. */
export const REFRESH = 'REFRESH';

/** At least this wide (dp), a widget shows its second column. */
const WIDE = 220;
/** At least this tall (dp), a widget has room for a header above its content. */
const TALL = 100;

interface Props {
  v: WidgetView;
  p: Palette;
  width: number;
  height: number;
}

/** Widget `name` for a widget `width`×`height` dp, in both colour schemes; the launcher picks the system's. */
export function renderWidget(name: WidgetName, v: WidgetView, width: number, height: number) {
  const draw = (dark: boolean) => {
    const props = { v, p: palette(dark), width, height };
    switch (name) {
      case 'RouterWidget':
        return <RouterWidget {...props} />;
      case 'SpeedWidget':
        return <SpeedWidget {...props} />;
      case 'DevicesWidget':
        return <DevicesWidget {...props} />;
      case 'SystemWidget':
        return <SystemWidget {...props} />;
      case 'WanWidget':
        return <WanWidget {...props} />;
      case 'ShortcutsWidget':
        return <ShortcutsWidget {...props} />;
    }
  };
  return { light: draw(false), dark: draw(true) };
}

function Card({
  p,
  name,
  padding = 14,
  children,
}: {
  p: Palette;
  name: WidgetName;
  padding?: number;
  children: unknown;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: WIDGET_LINKS[name] }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: p.background,
        borderRadius: 22,
        padding,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
      {children}
    </FlexWidget>
  );
}

/** ↻ reads the router from the home screen; without a saved password it opens the app, which does. */
function RefreshButton({ v, p, size = 28 }: { v: WidgetView; p: Palette; size?: number }) {
  const action = v.refreshable
    ? { clickAction: REFRESH }
    : { clickAction: 'OPEN_URI', clickActionData: { uri: 'routelink://overview' } };
  return (
    <FlexWidget
      {...action}
      accessibilityLabel={v.labels.refresh}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.button,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <SvgWidget
        svg={icon('refresh', v.refreshing ? p.accent : p.secondary)}
        style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }}
      />
    </FlexWidget>
  );
}

function Dot({ color }: { color: `#${string}` }) {
  return <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6 }} />;
}

/** Status dot, router name, ↻. */
function Header({ v, p, title = v.title }: { v: WidgetView; p: Palette; title?: string }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
      <Dot color={v.online ? p.green : p.tertiary} />
      <FlexWidget style={{ flex: 1, marginRight: 6 }}>
        <TextWidget
          text={title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 14, fontWeight: '600', color: p.text }}
        />
      </FlexWidget>
      <RefreshButton v={v} p={p} />
    </FlexWidget>
  );
}

/** Status dot and router name, without ↻ (it sits beside the content). */
function Title({ v, p }: { v: WidgetView; p: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
      <Dot color={v.online ? p.green : p.tertiary} />
      <TextWidget text={v.title} maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: '600', color: p.text }} />
    </FlexWidget>
  );
}

/** ↻ with the time of the data under it, for widgets one cell tall. */
function TimeAndRefresh({ v, p }: { v: WidgetView; p: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: 'column', alignItems: 'center', marginLeft: 6 }}>
      <RefreshButton v={v} p={p} size={26} />
      <TextWidget text={v.time} style={{ fontSize: 10, color: p.tertiary, marginTop: 2 }} />
    </FlexWidget>
  );
}

function Small({ text, p, color = p.tertiary }: { text: string; p: Palette; color?: `#${string}` }) {
  return <TextWidget text={text} maxLines={1} truncate="END" style={{ fontSize: 11, color }} />;
}

/** Before anything was read: what to do about it. */
function Empty({ v, p, name, height }: Props & { name: WidgetName }) {
  return (
    <Card p={p} name={name} padding={height < TALL ? 10 : 14}>
      {height >= TALL ? <Header v={v} p={p} /> : null}
      <TextWidget text={v.status} maxLines={2} truncate="END" style={{ fontSize: 14, color: p.secondary }} />
    </Card>
  );
}

function RouterWidget(props: Props) {
  const { v, p, width } = props;
  if (v.empty) return <Empty {...props} name="RouterWidget" />;
  const status = v.online ? p.green : p.secondary;
  return (
    <Card p={p} name="RouterWidget">
      <Header v={v} p={p} />
      <FlexWidget
        style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text={v.status} style={{ fontSize: 17, fontWeight: '700', color: status }} />
          <TextWidget text={v.devices} maxLines={1} style={{ fontSize: 13, color: p.text }} />
          <Small text={v.updated} p={p} />
        </FlexWidget>
        {width >= WIDE && v.online ? (
          <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
            <TextWidget text={`↓ ${v.down}`} style={{ fontSize: 15, fontWeight: '600', color: p.down }} />
            <TextWidget text={`↑ ${v.up}`} style={{ fontSize: 15, fontWeight: '600', color: p.up }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>
    </Card>
  );
}

function Rate({ label, value, color, p, size }: { label: string; value: string; color: `#${string}`; p: Palette; size: number }) {
  return (
    <FlexWidget style={{ flexDirection: 'column' }}>
      <TextWidget text={label} style={{ fontSize: 11, color: p.secondary }} />
      <TextWidget text={value} maxLines={1} style={{ fontSize: size, fontWeight: '700', color }} />
    </FlexWidget>
  );
}

function SpeedWidget(props: Props) {
  const { v, p, width, height } = props;
  if (v.empty) return <Empty {...props} name="SpeedWidget" />;
  if (height < 120) {
    // One row of cells: the two rates, ↻ and the time beside them (the router's name too, when it fits).
    return (
      <Card p={p} name="SpeedWidget" padding={10}>
        {height >= 90 ? <Title v={v} p={p} /> : null}
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
          <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
            {v.online
              ? [
                  <TextWidget key="down" text={`↓ ${v.down}`} maxLines={1} style={{ fontSize: 16, fontWeight: '700', color: p.down }} />,
                  <TextWidget key="up" text={`↑ ${v.up}`} maxLines={1} style={{ fontSize: 16, fontWeight: '700', color: p.up }} />,
                ]
              : <TextWidget text={v.status} maxLines={1} style={{ fontSize: 16, fontWeight: '700', color: p.secondary }} />}
          </FlexWidget>
          <TimeAndRefresh v={v} p={p} />
        </FlexWidget>
      </Card>
    );
  }
  const wide = width >= WIDE;
  return (
    <Card p={p} name="SpeedWidget">
      <Header v={v} p={p} />
      <FlexWidget style={{ flexDirection: wide ? 'row' : 'column', width: 'match_parent' }}>
        <FlexWidget style={{ flex: wide ? 1 : 0 }}>
          <Rate label={v.labels.down} value={v.down} color={p.down} p={p} size={wide ? 22 : 18} />
        </FlexWidget>
        <FlexWidget style={{ flex: wide ? 1 : 0 }}>
          <Rate label={v.labels.up} value={v.up} color={p.up} p={p} size={wide ? 22 : 18} />
        </FlexWidget>
      </FlexWidget>
      <Small text={v.online ? v.updated : `${v.status} · ${v.updated}`} p={p} />
    </Card>
  );
}

function DevicesWidget(props: Props) {
  const { v, p, width, height } = props;
  if (v.empty) return <Empty {...props} name="DevicesWidget" />;
  const tall = height >= TALL;
  // Names beside the count in a wide widget, as many as fit (about 18 dp a line).
  const lines = width >= WIDE ? Math.max(0, Math.min(v.deviceNames.length, Math.floor((height - (tall ? 64 : 24)) / 18))) : 0;
  const count = (
    <FlexWidget style={{ flexDirection: 'column', marginRight: 12 }}>
      <TextWidget text={v.devicesCount} style={{ fontSize: tall ? 34 : 26, fontWeight: '700', color: p.text }} />
      <TextWidget text={v.online ? v.labels.devices : v.status} style={{ fontSize: 12, color: p.secondary }} />
      {v.devicesSplit && tall ? <Small text={v.devicesSplit} p={p} color={p.secondary} /> : null}
    </FlexWidget>
  );
  const names =
    lines > 0 ? (
      <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
        {v.deviceNames.slice(0, lines).map((n, i) => (
          <TextWidget
            key={`${i}:${n}`}
            text={`• ${n}`}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 13, color: p.text, lineHeight: 18 }}
          />
        ))}
      </FlexWidget>
    ) : null;
  if (!tall) {
    return (
      <Card p={p} name="DevicesWidget" padding={10}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 'match_parent' }}>
          {count}
          {names ?? <FlexWidget style={{ flex: 1 }} />}
          <RefreshButton v={v} p={p} size={26} />
        </FlexWidget>
      </Card>
    );
  }
  return (
    <Card p={p} name="DevicesWidget">
      <Header v={v} p={p} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        {count}
        {names}
      </FlexWidget>
      <Small text={v.updated} p={p} />
    </Card>
  );
}

function Bar({ label, gauge, p }: { label: string; gauge: Gauge; p: Palette }) {
  const filled = Math.round(gauge.ratio * 100);
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 4 }}>
      <TextWidget text={label} maxLines={1} style={{ fontSize: 12, color: p.secondary, width: 34 }} />
      <FlexWidget
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          backgroundColor: p.track,
          flexDirection: 'row',
          marginHorizontal: 6,
          overflow: 'hidden',
        }}>
        {filled > 0 ? (
          <FlexWidget
            style={{ flex: filled, height: 6, borderRadius: 3, backgroundColor: loadColor(p, gauge.ratio) }}
          />
        ) : null}
        {filled < 100 ? <FlexWidget style={{ flex: 100 - filled, height: 6 }} /> : null}
      </FlexWidget>
      <TextWidget text={gauge.value} style={{ fontSize: 12, fontWeight: '600', color: p.text, width: 36, textAlign: 'right' }} />
    </FlexWidget>
  );
}

function SystemWidget(props: Props) {
  const { v, p, height } = props;
  if (v.empty) return <Empty {...props} name="SystemWidget" />;
  const extra = [v.temperature ? `${v.labels.temperature} ${v.temperature}` : '', v.uptime ?? ''].filter(Boolean);
  return (
    <Card p={p} name="SystemWidget" padding={height < TALL ? 10 : 14}>
      {height >= TALL ? <Header v={v} p={p} /> : null}
      {v.online ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          {v.cpu ? <Bar label={v.labels.cpu} gauge={v.cpu} p={p} /> : null}
          {v.memory ? <Bar label={v.labels.memory} gauge={v.memory} p={p} /> : null}
          {height >= TALL
            ? extra.map((line) => <Small key={line} text={line} p={p} color={p.secondary} />)
            : null}
        </FlexWidget>
      ) : (
        <TextWidget text={v.status} style={{ fontSize: 17, fontWeight: '700', color: p.secondary }} />
      )}
      {height >= TALL ? <Small text={v.updated} p={p} /> : null}
    </Card>
  );
}

function WanWidget(props: Props) {
  const { v, p, height } = props;
  if (v.empty) return <Empty {...props} name="WanWidget" />;
  const tall = height >= TALL;
  return (
    <Card p={p} name="WanWidget" padding={tall ? 12 : 10}>
      {tall ? <Header v={v} p={p} /> : null}
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Dot color={v.wanUp ? p.green : p.tertiary} />
            <TextWidget
              text={`${v.labels.wan} · ${v.wanStatus}`}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 12, color: p.secondary }}
            />
          </FlexWidget>
          <TextWidget
            text={v.wanIp || '—'}
            maxLines={1}
            style={{ fontSize: tall ? 20 : 17, fontWeight: '700', color: p.text, marginTop: 2 }}
          />
        </FlexWidget>
        {tall ? (
          <TextWidget text={v.time} style={{ fontSize: 11, color: p.tertiary, marginLeft: 6 }} />
        ) : (
          <TimeAndRefresh v={v} p={p} />
        )}
      </FlexWidget>
    </Card>
  );
}

function ShortcutsWidget({ v, p, width, height }: Props) {
  // About 60 dp a button.
  const shown = SHORTCUTS.slice(0, Math.max(2, Math.min(SHORTCUTS.length, Math.floor((width - 20) / 60))));
  const circle = height >= TALL ? 46 : 36;
  return (
    <Card p={p} name="ShortcutsWidget" padding={10}>
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          width: 'match_parent',
          height: 'match_parent',
        }}>
        {shown.map((s) => (
          <FlexWidget
            key={s.key}
            clickAction="OPEN_URI"
            clickActionData={{ uri: s.uri }}
            accessibilityLabel={v.labels[s.key]}
            style={{ flexDirection: 'column', alignItems: 'center' }}>
            <FlexWidget
              style={{
                width: circle,
                height: circle,
                borderRadius: circle / 2,
                backgroundColor: p.button,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <SvgWidget svg={icon(s.icon, p.accent)} style={{ width: circle / 2, height: circle / 2 }} />
            </FlexWidget>
            <TextWidget
              text={v.labels[s.key]}
              maxLines={1}
              style={{ fontSize: 11, color: p.text, marginTop: 4 }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>
    </Card>
  );
}
