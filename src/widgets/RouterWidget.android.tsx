'use no memo';
// The React Compiler would add hooks; widgets are drawn outside React's renderer, where hooks fail.
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetProps } from './props';

/** AP-4 on Android (react-native-android-widget): drawn to a bitmap from these props, tap opens the app. */
export function RouterWidget({ props, dark, wide }: { props: WidgetProps; dark: boolean; wide: boolean }) {
  const text = dark ? '#FFFFFF' : '#1C1C1E';
  const secondary = dark ? '#AEAEB2' : '#6C6C70';
  const green = '#34C759';
  const status = props.online ? green : secondary;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'routelink://overview' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: dark ? '#1C1C1EF0' : '#FFFFFFF0',
        borderRadius: 22,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status, marginRight: 6 }} />
        <TextWidget
          text={props.title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 14, fontWeight: '600', color: text }}
        />
      </FlexWidget>
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          width: 'match_parent',
        }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text={props.status} style={{ fontSize: 17, fontWeight: '700', color: status }} />
          <TextWidget text={props.devices} style={{ fontSize: 13, color: text }} />
          <TextWidget text={props.updated} style={{ fontSize: 11, color: secondary }} />
        </FlexWidget>
        {wide && props.online ? (
          <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
            <TextWidget text={props.down} style={{ fontSize: 15, fontWeight: '600', color: text }} />
            <TextWidget text={props.up} style={{ fontSize: 15, fontWeight: '600', color: text }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}
