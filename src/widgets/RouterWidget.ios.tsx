import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { WidgetProps } from './props';

/**
 * AP-4 on iOS (expo-widgets). Runs in the widget extension's own runtime: only props, environment and
 * @expo/ui components — nothing else from this file or the app is reachable in here.
 */
const RouterWidget = (props: WidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const green = '#34C759';
  const grey = '#8E8E93';
  const header = (
    <HStack spacing={6}>
      <Image systemName="wifi.router" modifiers={[foregroundStyle(props.online ? green : grey)]} />
      <Text modifiers={[font({ weight: 'semibold', size: 15 }), lineLimit(1)]}>{props.title}</Text>
      <Spacer />
    </HStack>
  );
  if (environment.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[widgetURL('routelink://overview')]}>
        {header}
        <Spacer />
        <Text modifiers={[font({ weight: 'bold', size: 17 }), foregroundStyle(props.online ? green : grey)]}>
          {props.status}
        </Text>
        <Text modifiers={[font({ size: 13 })]}>{props.devices}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(grey)]}>{props.updated}</Text>
      </VStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={2} modifiers={[widgetURL('routelink://overview')]}>
      {header}
      <Spacer />
      <HStack alignment="bottom">
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ weight: 'bold', size: 17 }), foregroundStyle(props.online ? green : grey)]}>
            {props.status}
          </Text>
          <Text modifiers={[font({ size: 13 })]}>{props.devices}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text modifiers={[font({ size: 15, design: 'rounded', weight: 'semibold' })]}>{props.down}</Text>
          <Text modifiers={[font({ size: 15, design: 'rounded', weight: 'semibold' })]}>{props.up}</Text>
        </VStack>
      </HStack>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(grey)]}>{props.updated}</Text>
    </VStack>
  );
};

export default createWidget('RouterWidget', RouterWidget);
