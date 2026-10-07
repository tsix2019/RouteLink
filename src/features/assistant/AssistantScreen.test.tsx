import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { resetDemoConnection } from '@/api/connection/manager';
import Assistant from '@/app/assistant';
import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { initI18n } from '@/i18n';
import { useAssistant } from '@/state/assistant';
import { useSettings } from '@/state/settings';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
}));

// The demo assistant streams its answer in small pieces, like a real one.
const ANSWERED = { timeout: 8_000 };
jest.setTimeout(30_000);

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ActiveRouterProvider>{children}</ActiveRouterProvider>
    </QueryClientProvider>
  );
}

beforeAll(() => initI18n('en'));
beforeEach(() => {
  resetDemoConnection();
  useSettings.setState({ demoMode: true });
  useAssistant.getState().clear();
});

it('asks a suggested question, answers it, and keeps the conversation in the history', async () => {
  await render(<Assistant />, { wrapper: Providers });
  expect(screen.getByText('How can I help?')).toBeTruthy();
  expect(screen.getByTestId('assistant-new')).toBeDisabled();

  await fireEvent.press(await screen.findByTestId('assistant-suggestion-1'));
  // The question in its bubble, then the answer with the step it took to get there.
  expect(await screen.findByText('Which devices are online?')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('assistant-regenerate')).toBeTruthy(), ANSWERED);
  expect(screen.getByText(/are online: \d+ on Wi-Fi/)).toBeTruthy();
  expect(screen.getByText('Looked at device list')).toBeTruthy();
  expect(screen.queryByText('How can I help?')).toBeNull();

  // The history lists it; a new chat starts empty and the old one opens again from there.
  const [conversation] = Object.values(useAssistant.getState().conversations);
  expect(screen.queryByTestId(`assistant-history-${conversation.id}`)).toBeNull();
  await fireEvent.press(screen.getByTestId('assistant-new'));
  expect(screen.getByText('How can I help?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('assistant-history-open'));
  expect(screen.getByText('Today')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`assistant-history-${conversation.id}`));
  expect(screen.queryByText('How can I help?')).toBeNull();
  expect(screen.getByText('Which devices are online?')).toBeTruthy();
  expect(screen.getByTestId('assistant-regenerate')).toBeTruthy();
});

it('asks before a change and shows the choice in the steps', async () => {
  await render(<Assistant />, { wrapper: Providers });
  await act(async () => fireEvent.changeText(screen.getByTestId('assistant-input'), 'Please reboot the router'));
  await fireEvent.press(screen.getByTestId('assistant-send'));
  await waitFor(() => expect(screen.getByTestId('assistant-confirm')).toBeTruthy(), ANSWERED);
  expect(screen.getByText('Waiting for you: restart the router')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('assistant-decline'));
  await waitFor(() => expect(screen.getByText(/won't restart/)).toBeTruthy(), ANSWERED);
  expect(screen.getByText('Cancelled restart the router')).toBeTruthy();
});
