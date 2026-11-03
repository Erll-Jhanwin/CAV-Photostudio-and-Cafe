import { render, screen } from '@testing-library/react';
import ProductSalesLossSummary from './ProductSalesLossSummary';

const apiRows = [
  { product_id: 1, loss: '80.00' },
  { product_id: 2, loss: '50.00' },
];

test('shows wastage plus refunds and restores the same total after the page component reloads', () => {
  const props = {
    rows: apiRows,
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    onStartDateChange: jest.fn(),
    onEndDateChange: jest.fn(),
  };
  const firstPage = render(<ProductSalesLossSummary {...props} />);
  expect(screen.getByText('Total loss PHP 130.00')).toBeInTheDocument();
  firstPage.unmount();

  render(<ProductSalesLossSummary {...props} />);
  expect(screen.getByText('Total loss PHP 130.00')).toBeInTheDocument();
  expect(screen.getByLabelText('Product loss start date')).toHaveValue('2026-11-03');
  expect(screen.getByLabelText('Product loss end date')).toHaveValue('2026-11-03');
});
