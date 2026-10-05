import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';

import { CustomRangeSheet, TimeRangePicker } from './TimeRangePicker';
import type { TimeRange } from './timeRange';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  const Picker = () => <View testID="native-picker" />;
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});

beforeAll(() => {
  initI18n('en');
});

describe('TimeRangePicker', () => {
  it('reports the preset that was tapped, keeping the hour window', async () => {
    const onChange = jest.fn();
    const value: TimeRange = { kind: 'preset', id: 'today', hours: { from: 20, to: 23 } };
    await render(<TimeRangePicker value={value} onChange={onChange} />);
    await fireEvent.press(screen.getByText('Last 7 days'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', id: 'last7d', hours: { from: 20, to: 23 } });
  });

  it('spells out the selected range', async () => {
    await render(<TimeRangePicker value={{ kind: 'preset', id: 'today' }} onChange={jest.fn()} />);
    expect(screen.getByText(/00:00 – /)).toBeTruthy();
  });

  it('opens the custom sheet', async () => {
    await render(<TimeRangePicker value={{ kind: 'preset', id: 'today' }} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('range-custom'));
    expect(screen.getByText('Custom range')).toBeTruthy();
  });
});

describe('CustomRangeSheet', () => {
  const now = new Date('2026-10-05T13:47:00+08:00');
  const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it('accepts a valid range', async () => {
    const onDone = jest.fn();
    const initial: TimeRange = { kind: 'custom', start: sec('2026-10-01T08:00:00+08:00'), end: sec('2026-10-03T08:00:00+08:00') };
    await render(<CustomRangeSheet initial={initial} now={now} onCancel={jest.fn()} onDone={onDone} />);
    await fireEvent.press(screen.getByTestId('custom-done'));
    expect(onDone).toHaveBeenCalledWith({ ...initial, hours: undefined });
  });

  it('disables Done when the end is before the start', async () => {
    const onDone = jest.fn();
    const initial: TimeRange = { kind: 'custom', start: sec('2026-10-03T08:00:00+08:00'), end: sec('2026-10-01T08:00:00+08:00') };
    await render(<CustomRangeSheet initial={initial} now={now} onCancel={jest.fn()} onDone={onDone} />);
    expect(screen.getByTestId('custom-error')).toHaveTextContent('The end must be after the start.');
    await fireEvent.press(screen.getByTestId('custom-done'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('adds an hour window with the toggle', async () => {
    const onDone = jest.fn();
    const initial: TimeRange = { kind: 'custom', start: sec('2026-10-01T08:00:00+08:00'), end: sec('2026-10-03T08:00:00+08:00') };
    await render(<CustomRangeSheet initial={initial} now={now} onCancel={jest.fn()} onDone={onDone} />);
    await fireEvent(screen.getByLabelText('Only some hours of each day'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('From 21:00'));
    await fireEvent.press(screen.getByTestId('custom-done'));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ hours: { from: 21, to: 23 } }));
  });
});
