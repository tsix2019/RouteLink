import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';

import { RiskConfirm } from './RiskConfirm';

beforeAll(() => {
  initI18n('en');
});

it('high level requires the checkbox and the exact phrase', async () => {
  const onConfirm = jest.fn();
  await render(
    <RiskConfirm
      visible
      level="high"
      title="Flash firmware"
      consequences={['May brick the router']}
      confirmLabel="Go"
      confirmPhrase="OpenWrt"
      onConfirm={onConfirm}
      onCancel={jest.fn()}
    />,
  );
  const go = screen.getByRole('button', { name: 'Go' });
  expect(go).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.changeText(screen.getByTestId('risk-confirm-phrase'), 'openwrt');
  expect(go).toBeDisabled(); // case-sensitive

  await fireEvent.changeText(screen.getByTestId('risk-confirm-phrase'), 'OpenWrt');
  expect(go).toBeEnabled();
  await fireEvent.press(go);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('high level stays disabled with the phrase but without the checkbox', async () => {
  await render(
    <RiskConfirm visible level="high" title="t" consequences={[]} confirmLabel="Go" confirmPhrase="R1" onConfirm={jest.fn()} onCancel={jest.fn()} />,
  );
  await fireEvent.changeText(screen.getByTestId('risk-confirm-phrase'), 'R1');
  expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
});

it('medium level lists consequences and confirms directly', async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await render(
    <RiskConfirm
      visible
      level="medium"
      title="Reboot router"
      consequences={['All devices lose connection for 1–2 minutes']}
      confirmLabel="Reboot"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByText('All devices lose connection for 1–2 minutes')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reboot' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('renders nothing when hidden', async () => {
  await render(
    <RiskConfirm visible={false} level="medium" title="Hidden" consequences={[]} confirmLabel="Go" onConfirm={jest.fn()} onCancel={jest.fn()} />,
  );
  expect(screen.queryByText('Hidden')).toBeNull();
});
