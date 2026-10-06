/**
 * Smoke tests of the Wi-Fi tool screens against the demo network group (gateway + demo AP): they load,
 * show the group's devices and wire up their actions. Navigation chrome and charts are stubbed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import RouteLinkNative from 'routelink-native';

import { DEMO_AP_ID, DEMO_AP_NAME, DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { getDemoApConnection, getDemoConnection, resetDemoConnection } from '@/api/connection/manager';
import { getGroupClients } from '@/api/group';
import SignalDetail from '@/app/(tabs)/wireless/tools/signal/[mac]';
import SignalMonitor from '@/app/(tabs)/wireless/tools/signal/index';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { initI18n } from '@/i18n';
import { useSettings } from '@/state/settings';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/ui/Screen', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    Screen: ({ children, top }: { children: ReactNode; top?: ReactNode }) => createElement(View, null, top, children),
    HeaderButton: () => null,
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
jest.mock('./SignalChart', () => ({ SignalChart: () => null }));

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

const gateway = { id: DEMO_ROUTER_ID, name: 'RouteLink Demo' };
const groupClients = async () =>
  (
    await getGroupClients(getDemoConnection(), gateway, [
      { id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: getDemoApConnection() },
    ])
  ).clients;

beforeAll(() => {
  initI18n('en');
});

beforeEach(async () => {
  resetDemoConnection();
  useSettings.setState({ demoMode: true });
  mockPush.mockClear();
  mockParams = {};
  // The phone is the demo's Pixel 9.
  const pixel = (await groupClients()).find((c) => c.name === 'Pixel-9')!;
  (RouteLinkNative.getNetworkInfo as jest.Mock).mockResolvedValue({
    isWifi: true,
    ip: pixel.ipv4,
    netmask: '255.255.255.0',
    gateway: '192.168.8.1',
    ifname: 'wlan0',
  });
});

describe('signal monitor', () => {
  it('lists the wireless devices of the gateway and the AP, weakest first', async () => {
    await render(wrap(<SignalMonitor />));
    await waitFor(() => expect(screen.getByText('Living-Room-TV')).toBeTruthy());
    expect(screen.getByText(/^Wireless devices: \d+/)).toBeTruthy();
    expect(screen.getByText('This phone')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId(`signal-${(await groupClients()).find((c) => c.name === 'Living-Room-TV')!.mac}`),
    );
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/wireless\/tools\/signal\/.+\?router=demo-ap$/));
  });

  it('shows one device live on its AP, with history and roaming from the plugin', async () => {
    const tv = (await groupClients()).find((c) => c.name === 'Living-Room-TV')!;
    mockParams = { mac: encodeURIComponent(tv.mac), router: DEMO_AP_ID };
    await render(wrap(<SignalDetail />));
    await waitFor(() => expect(screen.getAllByText(/^-\d+ dBm$/).length).toBeGreaterThan(0));
    expect(screen.getByText(new RegExp(`^${DEMO_AP_NAME} · 5 GHz`))).toBeTruthy();
    expect(screen.getByText('Last 5 minutes')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Signal history')).toBeTruthy());
    expect(screen.getByText('Roaming')).toBeTruthy();
  });
});
