import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { CapabilityState } from '@/api/capabilities';
import { initI18n } from '@/i18n';

import { FeatureGate } from './FeatureGate';

let mockState: CapabilityState | undefined;
jest.mock('@/hooks/router-queries', () => ({
  useCapabilities: () => ({ data: mockState ? { 'network.wireguard': mockState } : undefined }),
}));

beforeAll(() => {
  initI18n('en');
});

const gate = () => (
  <FeatureGate feature="network.wireguard" icon="vpn">
    <Text>tunnels</Text>
  </FeatureGate>
);

describe('FeatureGate', () => {
  it('shows the page while loading and when available', async () => {
    mockState = undefined;
    await render(gate());
    expect(screen.getByText('tunnels')).toBeTruthy();
    mockState = { status: 'ok' };
    await render(gate());
    expect(screen.getByText('tunnels')).toBeTruthy();
  });

  it('names the package that adds the feature', async () => {
    mockState = { status: 'missing-package', packages: ['luci-proto-wireguard'] };
    await render(gate());
    expect(screen.queryByText('tunnels')).toBeNull();
    expect(screen.getByText('Not available on this router')).toBeTruthy();
    expect(screen.getByText(/Install luci-proto-wireguard on the router/)).toBeTruthy();
  });

  it('says when the router cannot offer it at all', async () => {
    mockState = { status: 'unsupported' };
    await render(gate());
    expect(screen.getByText("This router doesn't offer it.")).toBeTruthy();
  });
});
