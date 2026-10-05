import { activeWindow, cronDays, describeDays, describeWindow, type Weekday } from './weekly';

describe('describeDays', () => {
  it.each([
    [[0, 1, 2, 3, 4, 5, 6], '每天', 'Every day'],
    [[1, 2, 3, 4, 5], '周一至周五', 'Weekdays'],
    [[0, 6], '周末', 'Weekends'],
    [[0, 1, 2, 3, 4], '周日至周四', 'Sun–Thu'],
    [[5, 6, 0], '周五至周日', 'Fri–Sun'],
    [[1, 3, 5], '周一、周三、周五', 'Mon, Wed, Fri'],
    [[0, 1], '周一、周日', 'Mon, Sun'],
    [[3], '周三', 'Wed'],
  ] as const)('%j', (days, zh, en) => {
    expect(describeDays(days as unknown as Weekday[], 'zh-CN')).toBe(zh);
    expect(describeDays(days as unknown as Weekday[], 'en')).toBe(en);
  });
});

describe('describeWindow', () => {
  it('marks windows that end the next day', () => {
    expect(describeWindow('13:00', '15:00', 'zh-CN')).toBe('13:00–15:00');
    expect(describeWindow('21:30', '07:00', 'zh-CN')).toBe('21:30–07:00（次日）');
    expect(describeWindow('22:00', '00:00', 'en')).toBe('22:00–00:00 (next day)');
  });
});

describe('cronDays and activeWindow', () => {
  it('uses * for every day', () => {
    expect(cronDays([0, 1, 2, 3, 4, 5, 6])).toBe('*');
    expect(cronDays([5, 1])).toBe('1,5');
  });

  it('finds the window that covers a moment', () => {
    const w = { days: [5] as Weekday[], from: '22:00', to: '02:00' };
    expect(activeWindow([w], 5, 23 * 60)).toBe(w);
    expect(activeWindow([w], 6, 60)).toBe(w);
    expect(activeWindow([w], 6, 3 * 60)).toBeNull();
  });
});
