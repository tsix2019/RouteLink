import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DEMO_AP_ID, DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { getDemoApConnection, getDemoConnection, resetDemoConnection } from '@/api/connection/manager';
import { getAgentDevices } from '@/api/services/agent';
import { agentStations } from '@/api/services/agent-wifi';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { useSettings } from '@/state/settings';

import { useGroupWifiPlugins, useLiveStation, useRoaming, useSignalHistory } from './useGroupWifi';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return (
    <QueryClientProvider client={client}>
      <ActiveRouterProvider>{children}</ActiveRouterProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetDemoConnection();
  useSettings.setState({ demoMode: true });
});

/** A device associated with the demo AP. */
const apStation = async () => (await agentStations(getDemoApConnection())).stations[0].mac;

describe('Wi-Fi tools in demo mode', () => {
  it('finds the plugin with its Wi-Fi module on the gateway and the AP', async () => {
    const { result } = await renderHook(() => useGroupWifiPlugins(), { wrapper });
    await waitFor(() => expect(result.current.every((r) => !r.loading)).toBe(true));
    expect(result.current.map((r) => [r.id, r.wifi])).toEqual([
      [DEMO_ROUTER_ID, true],
      [DEMO_AP_ID, true],
    ]);
  });

  it('samples a station live on its AP, starting with what the plugin remembers', async () => {
    const mac = await apStation();
    const { result } = await renderHook(() => useLiveStation(DEMO_AP_ID, mac, true, true), { wrapper });
    await waitFor(() => expect(result.current.data?.station).toBeTruthy());
    expect(result.current.data).toMatchObject({ source: 'plugin', station: { band: expect.any(String) } });
    await waitFor(() => expect(result.current.samples.length).toBeGreaterThan(10));
    const ts = result.current.samples.map((s) => s.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('reads the station from iwinfo without the plugin', async () => {
    const mac = await apStation();
    const { result } = await renderHook(() => useLiveStation(DEMO_AP_ID, mac, false, true), { wrapper });
    await waitFor(() => expect(result.current.data?.station).toBeTruthy());
    expect(result.current.data?.source).toBe('iwinfo');
    expect(result.current.samples).toHaveLength(1);
  });

  it('merges the signal history and the roaming record of the group', async () => {
    const iphone = (await getAgentDevices(getDemoConnection())).find((d) => d.hostname === 'iPhone-16-Pro')!;
    const end = Math.floor(Date.now() / 1000);
    const start = end - 2 * 86_400;
    const { result } = await renderHook(
      () => {
        const routers = useGroupWifiPlugins().filter((r) => r.wifi);
        return {
          routers,
          history: useSignalHistory(routers, iphone.mac, start, end),
          roaming: useRoaming(routers, iphone.mac, start, end),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.routers).toHaveLength(2));
    await waitFor(() => expect(result.current.roaming.entries.length).toBeGreaterThanOrEqual(4));
    const { entries } = result.current.roaming;
    expect(new Set(entries.map((e) => e.routerId))).toEqual(new Set([DEMO_ROUTER_ID, DEMO_AP_ID]));
    expect(entries.some((e) => e.kind === 'connect' && e.roamed)).toBe(true);
    await waitFor(() => expect(result.current.history.history?.points.some((p) => p.signal !== null)).toBe(true));
  });
});
