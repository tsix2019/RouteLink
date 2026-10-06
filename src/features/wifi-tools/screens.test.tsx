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
import { getRadios } from '@/api/services/wireless';
import Intruders from '@/app/(tabs)/devices/intruders';
import Channels from '@/app/(tabs)/wireless/tools/channels';
import Security from '@/app/(tabs)/wireless/tools/security';
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
// The native random source is not there under Jest: the password generator gets Node's.
jest.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) => jest.requireActual('crypto').webcrypto.getRandomValues(bytes),
}));

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

describe('intruder check', () => {
  it('scans, sums up the phone’s SSID and offers the actions for a stranger', async () => {
    await render(wrap(<Intruders />));
    expect(screen.getByText('Scanning…')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('intruders-summary')).toBeTruthy(), { timeout: 6_000 });
    expect(screen.getByText(/^Online on “RouteLink-5G”: \d+, unknown: \d+$/)).toBeTruthy();
    expect(screen.getAllByText('This phone').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('segment:All devices'));
    expect(screen.getByText(/^Online: \d+/)).toBeTruthy();

    const strangers = screen.getAllByText('Unknown');
    await fireEvent.press(strangers[0]);
    expect(screen.getByText('Device details')).toBeTruthy();
    await fireEvent.press(screen.getByText('Trust this device'));
    // Written to the plugin's UCI, then read back.
    await waitFor(() => expect(screen.getAllByText('Unknown')).toHaveLength(strangers.length - 1));
  });
});

describe('channel optimisation', () => {
  it('scans both routers, advises every radio and switches one through a safe apply', async () => {
    await render(wrap(<Channels />));
    await fireEvent.press(screen.getByTestId('channels-scan'));
    await waitFor(() => expect(screen.getByTestId('channels-summary')).toBeTruthy());
    // 2.4 GHz is shown first: both routers' radios.
    expect(screen.getByTestId('channels-demo/radio0')).toBeTruthy();
    expect(screen.getByTestId('channels-demo-ap/radio0')).toBeTruthy();

    await fireEvent.press(screen.getByText('segment:5 GHz'));
    expect(screen.getByText(/^Radios worth changing: \d$/)).toBeTruthy();

    const button = screen.getAllByText(/^Switch to channel \d+$/)[0];
    const channel = Number(/\d+$/.exec(String(button.props.children))![0]);
    await fireEvent.press(button);
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(async () => {
      const channels = [...(await getRadios(getDemoConnection())), ...(await getRadios(getDemoApConnection()))].map(
        (r) => r.channel,
      );
      expect(channels).toContain(String(channel));
    });
  });
});

describe('security check', () => {
  it('rates every network and fixes the AP’s weak one, synced to the same-name networks', async () => {
    await render(wrap(<Security />));
    await waitFor(() => expect(screen.getByTestId('security-summary')).toBeTruthy());
    expect(screen.getByText(/^Overall security: /)).toBeTruthy();
    const card = 'demo-ap-default_radio0';
    expect(screen.getByTestId(`security-${card}`)).toBeTruthy();
    expect(screen.getAllByText(/^Password strength: weak \(.*contains the network name/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId(`security-fix-${card}`));
    expect(screen.getByText('Upgrade to WPA2/WPA3 mixed')).toBeTruthy();
    const key = String(screen.getByTestId('security-key').props.value);
    expect(key).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);
    expect(screen.getByTestId('security-sync')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('security-sheet-save'));
    await fireEvent.press(screen.getByText('Confirm'));

    await waitFor(
      async () => {
        const ap = (await getRadios(getDemoApConnection()))[0].networks[0];
        expect(ap).toMatchObject({ encryption: 'sae-mixed', key, wps: false });
        // The gateway's network of the same name follows (one safe apply per router).
        const gw = (await getRadios(getDemoConnection()))
          .flatMap((r) => r.networks)
          .find((n) => n.ssid === 'RouteLink');
        expect(gw).toMatchObject({ encryption: 'sae-mixed', key });
        // Each safe apply waits 1.5 s before confirming.
      },
      { timeout: 8_000 },
    );
    await waitFor(() => expect(screen.getByTestId('security-share')).toBeTruthy(), { timeout: 5_000 });
  }, 20_000);
});
