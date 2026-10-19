import { getManilaDateInputValue, getManilaTimeInputValue, manilaInputToISOString } from './dateTime';

test('Manila payment date and time round-trip independently of browser timezone', () => {
  const instant = manilaInputToISOString('2026-10-19', '00:30');
  expect(instant).toBe('2026-10-18T16:30:00.000Z');
  expect(getManilaDateInputValue(instant)).toBe('2026-10-19');
  expect(getManilaTimeInputValue(new Date(instant))).toBe('00:30');
});

test.each([['2026-02-30', '09:00'], ['2026-10-19', '25:00'], ['', '09:00']])(
  'rejects invalid payment input %s %s before booking submission', (day, time) => {
    expect(() => manilaInputToISOString(day, time)).toThrow('Enter a valid payment date and time.');
  },
);
