import { getManilaDateInputValue } from './dateTime';

const parseDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
};

const dateValue = date => date.toISOString().slice(0, 10);

export const getDashboardRangeDates = (preset, customStart, customEnd, now = new Date()) => {
  const today = parseDate(getManilaDateInputValue(now));
  const offsetDay = (value, days) => {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  };
  let start = today;
  let end = today;

  if (preset === 'yesterday') {
    start = offsetDay(today, -1);
    end = start;
  } else if (preset === 'week') {
    // Match the dashboard's existing Sunday-to-today week definition.
    start = offsetDay(today, -today.getUTCDay());
  } else if (preset === 'month') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else if (preset === 'year') {
    start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  } else if (preset === 'custom') {
    start = parseDate(customStart) || today;
    end = parseDate(customEnd) || today;
  }

  const startValue = dateValue(start);
  const endValue = dateValue(end);
  return startValue <= endValue
    ? { start: startValue, end: endValue }
    : { start: endValue, end: startValue };
};
