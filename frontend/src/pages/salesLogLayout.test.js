import { calculateSalesRowsPerPage } from './salesLogLayout';

test('fits more rows in the available desktop table height', () => {
  expect(calculateSalesRowsPerPage({
    availableHeight: 720,
    headerHeight: 44,
    rowHeights: [44, 48, 46],
  })).toBe(14);
});

test('fits fewer wrapped rows in a narrow mobile table viewport', () => {
  expect(calculateSalesRowsPerPage({
    availableHeight: 180,
    headerHeight: 44,
    rowHeights: [62, 58],
  })).toBe(2);
});

test('always allows one row when the screen is very short', () => {
  expect(calculateSalesRowsPerPage({
    availableHeight: 80,
    headerHeight: 44,
    rowHeights: [60],
  })).toBe(1);
});

test('caps page size and uses a fallback row measurement for an empty table', () => {
  expect(calculateSalesRowsPerPage({
    availableHeight: 5000,
    headerHeight: 44,
    rowHeights: [],
  })).toBe(50);
});
