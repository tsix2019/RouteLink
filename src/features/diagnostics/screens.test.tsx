/**
 * Smoke tests of the diagnostics screens against the demo network group (gateway + demo AP, plugin
 * installed): they load, run and wire up their actions. Navigation chrome is stubbed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Share } from 'react-native';
import RouteLinkNative from 'routelink-native';

import { DEMO_AP_NAME } from '@/api/connection/demo/connection';
import { resetDemoConnection } from '@/api/connection/manager';
import Diagnosis from '@/app/(tabs)/network/diagnostics/index';
import DiagnosticTools from '@/app/(tabs)/network/diagnostics/tools';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { initI18n } from '@/i18n';
import { useSettings } from '@/state/settings';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: mockPush }),
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/ui/Screen', () => {
  const { createElement } = jest.requireActual('react');
  const { Text, View } = jest.requireActual('react-native');
  return {
    Screen: ({ children, top, headerRight }: { children: ReactNode; top?: ReactNode; headerRight?: ReactNode }) =>
      createElement(View, null, headerRight, top, children),
    HeaderButton: ({ onPress, accessibilityLabel }: { onPress(): void; accessibilityLabel: string }) =>
      createElement(Text, { onPress }, `header:${accessibilityLabel}`),
  };
});
jest.mock('@/ui/Segmented', () => {
  const { createElement } = jest.requireActual('react');
  const { Text, View } = jest.requireActual('react-native');
  return {
    Segmented: ({
      values,
      onChange,
    }: {
      values: string[];
      onChange(e: { nativeEvent: { selectedSegmentIndex: number } }): void;
    }) =>
      createElement(
        View,
        null,
        values.map((v, i) =>
          createElement(
            Text,
            { key: v, onPress: () => onChange({ nativeEvent: { selectedSegmentIndex: i } }) },
            `segment:${v}`,
          ),
        ),
      ),
  };
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  return (
    <QueryClientProvider client={client}>
      <ActiveRouterProvider>{ui}</ActiveRouterProvider>
    </QueryClientProvider>
  );
}

beforeAll(() => {
  initI18n('en');
});

beforeEach(() => {
  resetDemoConnection();
  useSettings.setState({ demoMode: true });
  mockPush.mockClear();
  mockParams = {};
  (RouteLinkNative.getNetworkInfo as jest.Mock).mockResolvedValue({
    isWifi: true,
    ip: '10.9.9.9',
    netmask: '255.255.255.0',
    gateway: '10.9.9.1',
    ifname: 'wlan0',
  });
});

describe('one-click diagnosis', () => {
  it('runs every segment on open, heads with the demo redial and shares the text', async () => {
    await render(wrap(<Diagnosis />));
    expect(screen.getByText('Checking…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Run again')).toBeTruthy(), { timeout: 8_000 });
    expect(screen.getByText('Worth a look: Gateway WAN')).toBeTruthy();
    expect(screen.getByText(/^Signal at the access point -\d+ dBm/)).toBeTruthy();
    expect(screen.getByText('Reconnects in the last 24 h: 1')).toBeTruthy();
    expect(screen.getByText('HTTP check passed')).toBeTruthy();

    await fireEvent.press(screen.getAllByText('See the outage log, useful as evidence for your provider')[0]);
    expect(mockPush).toHaveBeenCalledWith('/network/diagnostics/latency', { withAnchor: true });

    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await fireEvent.press(screen.getByText('header:Share the results'));
    expect(share.mock.calls[0][0]).toMatchObject({
      message: expect.stringMatching(/^RouteLink network diagnosis · RouteLink Demo|^RouteLink network diagnosis · /),
    });

    await fireEvent.press(screen.getByText('Run again'));
    expect(screen.getByText('Checking…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Run again')).toBeTruthy(), { timeout: 8_000 });
  }, 20_000);
});

describe('diagnostic tools', () => {
  it('checks the target, pings from the gateway and traces from the AP', async () => {
    await render(wrap(<DiagnosticTools />));
    await fireEvent.press(screen.getByTestId('tools-run'));
    expect(screen.getByText('Enter a host name or an IP address')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('tools-target'), 'www.baidu.com');
    await fireEvent.press(screen.getByText('segment:10 pings'));
    await fireEvent.press(screen.getByTestId('tools-run'));
    await waitFor(() => expect(screen.getByTestId('tools-summary')).toBeTruthy());
    expect(screen.getAllByText('10')).toHaveLength(2); // sent and received
    expect(screen.getByText(/^Demo router · took \d+ s$/)).toBeTruthy();
    expect(screen.getByTestId('tools-raw').props.children).toMatch(/10 packets transmitted/);

    await fireEvent.press(screen.getByTestId('tools-router'));
    await fireEvent.press(screen.getByText(DEMO_AP_NAME));
    await fireEvent.press(screen.getByText('segment:Traceroute'));
    await fireEvent.press(screen.getByTestId('tools-run'));
    await waitFor(() => expect(screen.getByText(new RegExp(`^Hops · ${DEMO_AP_NAME} · took`))).toBeTruthy());
    expect(screen.getByText('192.168.8.1')).toBeTruthy();

    await fireEvent.press(screen.getByText('segment:nslookup'));
    await fireEvent.changeText(screen.getByTestId('tools-target'), 'nothing.invalid');
    await fireEvent.press(screen.getByTestId('tools-run'));
    await waitFor(() => expect(screen.getByText(/^Answers · /)).toBeTruthy());
  });
});
