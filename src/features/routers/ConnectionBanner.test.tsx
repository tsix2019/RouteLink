import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { NativeError } from '@/api/http/errors';
import { AuthError } from '@/api/ubus/errors';
import { initI18n } from '@/i18n';
import { useRouters } from '@/state/routers';

import type { ActiveRouterStatus } from './ActiveRouterProvider';
import { ConnectionBanner } from './ConnectionBanner';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

let mockActive: { status: ActiveRouterStatus; router: { id: string; name: string; isDemo: boolean } | null } = {
  status: 'ready',
  router: { id: 'r1', name: 'Home', isDemo: false },
};
jest.mock('./ActiveRouterProvider', () => ({ useActiveRouter: () => mockActive }));

const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;

beforeAll(() => {
  initI18n('en');
});

beforeEach(() => {
  mockPush.mockClear();
  mockActive = { status: 'ready', router: { id: 'r1', name: 'Home', isDemo: false } };
});

it('names the router when it is offline and offers a retry', async () => {
  const onRetry = jest.fn();
  await render(wrap(<ConnectionBanner error={new NativeError('ERR_TIMEOUT', 'timeout')} onRetry={onRetry} />));
  expect(screen.getByText("Can't reach Home")).toBeTruthy();
  await fireEvent.press(screen.getByText('Retry'));
  expect(onRetry).toHaveBeenCalled();
});

it('asks for the password again after a login failure and stores it', async () => {
  const update = jest.fn(async () => {});
  useRouters.setState({ update });
  await render(wrap(<ConnectionBanner error={new AuthError('BAD_CREDENTIALS')} />));
  expect(screen.getByText('Sign in to Home again')).toBeTruthy();
  await fireEvent.press(screen.getByText('Enter Password'));
  await fireEvent.changeText(screen.getByTestId('relogin-password'), 'new-secret');
  await fireEvent.press(screen.getByText('Sign In'));
  await waitFor(() => expect(update).toHaveBeenCalledWith('r1', {}, 'new-secret'));
});

it('also asks when the password was not saved', async () => {
  mockActive = { ...mockActive, status: 'needs-password' };
  await render(wrap(<ConnectionBanner error={null} />));
  expect(screen.getByText('Sign in to Home again')).toBeTruthy();
});

it('opens the trust screen once by itself when the certificate changed', async () => {
  const error = new NativeError('ERR_TLS_PIN_MISMATCH', 'pin');
  const first = await render(wrap(<ConnectionBanner error={error} />));
  expect(mockPush).toHaveBeenCalledWith('/trust-certificate');
  await first.unmount();
  await render(wrap(<ConnectionBanner error={error} />));
  expect(mockPush).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText('View Certificate'));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('shows nothing without an error', async () => {
  await render(wrap(<ConnectionBanner error={null} />));
  expect(screen.toJSON()).toBeNull();
});
