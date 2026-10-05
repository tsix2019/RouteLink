import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { parseInfo, type AgentStatus } from '@/api/services/agent';
import { initI18n } from '@/i18n';

import { AgentBanner } from './AgentBanner';
import { AgentGate } from './AgentGate';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockMutate = jest.fn();
jest.mock('@/hooks/router-queries', () => ({
  useRouterMutation: () => ({ mutate: mockMutate, isPending: false }),
}));

let mockStatus: { data?: AgentStatus; isError?: boolean; error?: unknown; refetch?: () => void } = {};
jest.mock('@/hooks/agent-queries', () => ({
  AGENT_KEY: 'agent',
  useAgentStatus: () => mockStatus,
}));

const info = (patch: Record<string, unknown> = {}) =>
  parseInfo({ version: '0.1.0', api: 1, conntrack_accounting: true, time_synced: true, ...patch });

beforeAll(() => {
  initI18n('en');
});

beforeEach(() => {
  mockPush.mockClear();
  mockMutate.mockClear();
});

describe('AgentGate', () => {
  const child = (i: ReturnType<typeof info>) => <Text>plugin {i.version}</Text>;

  it('renders the content when the plugin is ok', async () => {
    mockStatus = { data: { state: 'ok', info: info() } };
    await render(<AgentGate>{child}</AgentGate>);
    expect(screen.getByText('plugin 0.1.0')).toBeTruthy();
  });

  it('offers to install when it is missing', async () => {
    mockStatus = { data: { state: 'not-installed' } };
    await render(<AgentGate>{child}</AgentGate>);
    expect(screen.getByText('Needs the RouteLink plugin')).toBeTruthy();
    await fireEvent.press(screen.getByText('Install Plugin'));
    expect(mockPush).toHaveBeenCalledWith('/more/agent');
  });

  it('offers a restart when it is not running', async () => {
    mockStatus = { data: { state: 'not-running' } };
    await render(<AgentGate>{child}</AgentGate>);
    await fireEvent.press(screen.getByText('Restart Plugin'));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('asks to upgrade the plugin or the app', async () => {
    mockStatus = { data: { state: 'too-old', info: info({ api: 0 }) } };
    await render(<AgentGate>{child}</AgentGate>);
    expect(screen.getByText('Upgrade Plugin')).toBeTruthy();

    mockStatus = { data: { state: 'too-new', info: info({ api: 9 }) } };
    await render(<AgentGate>{child}</AgentGate>);
    expect(screen.getByText('Please update the app')).toBeTruthy();
  });

  it('explains missing permission', async () => {
    mockStatus = { data: { state: 'no-permission' } };
    await render(<AgentGate>{child}</AgentGate>);
    expect(screen.getByText(/Sign in as root/)).toBeTruthy();
  });
});

describe('AgentBanner', () => {
  it('shows nothing when all is well', async () => {
    await render(<AgentBanner info={info()} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('warns about offloading, the clock and counting', async () => {
    await render(
      <AgentBanner info={info({ offload_warning: true, time_synced: false, conntrack_accounting: false })} />,
    );
    expect(screen.getByText(/Hardware offloading is on/)).toBeTruthy();
    expect(screen.getByText(/clock is not synchronised/)).toBeTruthy();
    expect(screen.getByText(/nf_conntrack_acct/)).toBeTruthy();
  });

  it('stops nlbwmon after confirmation', async () => {
    await render(<AgentBanner info={info({ nlbwmon_running: true })} />);
    await fireEvent.press(screen.getByText('Stop It'));
    expect(mockMutate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Stop and Disable'));
    expect(mockMutate).toHaveBeenCalled();
  });
});
