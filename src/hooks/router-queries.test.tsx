import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { resetDemoConnection } from '@/api/connection/manager';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { useSettings } from '@/state/settings';

import { useClients, useRouterMutation, useSystem, useTraffic } from './router-queries';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ActiveRouterProvider>{children}</ActiveRouterProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetDemoConnection();
  useSettings.setState({ demoMode: true, refreshIntervalSec: 1 });
});

it('loads data from the demo router, keyed by router id', async () => {
  const { result } = await renderHook(() => useSystem(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.model).toBe('OpenWrt One');
});

it('builds a WAN rate series from successive counter reads', async () => {
  const { result } = await renderHook(() => useTraffic(), { wrapper });
  await waitFor(() => expect(result.current.wanDevice).toBe('pppoe-wan'));
  await waitFor(() => expect(result.current.series.length).toBeGreaterThanOrEqual(1), { timeout: 4_000 });
  expect(result.current.latest?.rxBps).toBeGreaterThan(0);
});

it('mutations invalidate the listed queries', async () => {
  const { result } = await renderHook(
    () => ({
      clients: useClients(),
      rename: useRouterMutation(async () => 'done', [['clients']]),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.clients.isSuccess).toBe(true));
  const before = result.current.clients.dataUpdatedAt;
  await act(async () => {
    await result.current.rename.mutateAsync(undefined);
  });
  await waitFor(() => expect(result.current.clients.dataUpdatedAt).toBeGreaterThan(before));
});
