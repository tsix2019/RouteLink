import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { resetDemoConnection } from '@/api/connection/manager';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { useSettings } from '@/state/settings';
import { useLocalTrust } from '@/state/trust';

import { setDeviceMarks } from './trust';
import { useTrust } from './useTrust';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('./trust', () => ({ ...jest.requireActual('./trust'), setDeviceMarks: jest.fn() }));

const write = setDeviceMarks as jest.MockedFunction<typeof setDeviceMarks>;

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
  write.mockReset();
  useSettings.setState({ demoMode: true });
  useLocalTrust.setState({ trusted: { [DEMO_ROUTER_ID]: ['AA:BB:CC:DD:EE:77'] } });
});

it('moves the local list to the plugin once, and does not retry on every render when that fails', async () => {
  write.mockRejectedValue(new Error('denied'));
  const { result, rerender } = await renderHook(() => useTrust(), { wrapper });
  await waitFor(() => expect(result.current.source).toBe('plugin'));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      rerender({});
      await Promise.resolve();
    });
  }
  expect(write).toHaveBeenCalledTimes(1);
  // Kept for the next visit.
  expect(useLocalTrust.getState().trusted[DEMO_ROUTER_ID]).toEqual(['AA:BB:CC:DD:EE:77']);
});

it('clears the local list once it is on the router', async () => {
  write.mockResolvedValue(undefined);
  const { result } = await renderHook(() => useTrust(), { wrapper });
  await waitFor(() => expect(result.current.source).toBe('plugin'));
  await waitFor(() => expect(useLocalTrust.getState().trusted[DEMO_ROUTER_ID]).toBeUndefined());
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][1]).toEqual([{ mac: 'AA:BB:CC:DD:EE:77', trusted: true }]);
});
