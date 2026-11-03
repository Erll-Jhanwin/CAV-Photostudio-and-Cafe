import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import LiveInventoryPage from './LiveInventoryPage';

test('renders a meaningful empty state and keeps both inventory sections navigable', () => {
  render(<LiveInventoryPage ingredients={[]} productSalesInventory={[]} onRefresh={jest.fn()} />);

  expect(screen.getByRole('heading', { name: 'No ingredients found' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Product Sales, Returns & Wastage' }));
  expect(screen.getByRole('heading', { name: 'No active products' })).toBeInTheDocument();
});

test('shows loading and error states and retries inventory loading', () => {
  const onRefresh = jest.fn();
  const { rerender } = render(<LiveInventoryPage ingredients={[]} loading onRefresh={onRefresh} />);

  expect(screen.getByRole('heading', { name: 'Loading inventory' })).toBeInTheDocument();
  rerender(<LiveInventoryPage ingredients={[]} error="Could not load inventory data." onRefresh={onRefresh} />);

  expect(screen.getByRole('alert')).toHaveTextContent('Could not load inventory data.');
  expect(screen.getByRole('heading', { name: 'Inventory unavailable' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Inventory' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
