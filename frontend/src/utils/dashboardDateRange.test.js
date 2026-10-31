import { getDashboardRangeDates } from './dashboardDateRange';

describe('getDashboardRangeDates', () => {
  const boundaryInstant = new Date('2026-10-31T16:30:00.000Z'); // 2026-11-01 00:30 in Manila.

  it('uses Asia/Manila calendar day for Today and Yesterday', () => {
    expect(getDashboardRangeDates('today', '', '', boundaryInstant)).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(getDashboardRangeDates('yesterday', '', '', boundaryInstant)).toEqual({ start: '2026-10-31', end: '2026-10-31' });
  });

  it('uses Manila date for week, month, and year presets', () => {
    expect(getDashboardRangeDates('week', '', '', boundaryInstant)).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(getDashboardRangeDates('month', '', '', boundaryInstant)).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(getDashboardRangeDates('year', '', '', boundaryInstant)).toEqual({ start: '2026-01-01', end: '2026-11-01' });
  });

  it('preserves custom dates and orders reversed ranges', () => {
    expect(getDashboardRangeDates('custom', '2026-11-05', '2026-11-02', boundaryInstant)).toEqual({
      start: '2026-11-02', end: '2026-11-05',
    });
  });
});
