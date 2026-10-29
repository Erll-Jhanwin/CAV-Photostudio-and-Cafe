import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import client from '../../api/client';
import IngredientStatusModal from './IngredientStatusModal';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

const ingredients = [
  { id: 1, name: 'Butter', stock_quantity: '4.50', base_unit: 'G', expiration_date: '2025-10-01', inventory_status: 'EXPIRED', inventory_status_label: 'Expired' },
  { id: 2, name: 'Coffee beans', stock_quantity: '20.00', base_unit: 'G', expiration_date: '2025-08-10', inventory_status: 'EXPIRED', inventory_status_label: 'Expired' },
  { id: 3, name: 'Fresh milk', stock_quantity: '2.00', base_unit: 'ML', expiration_date: '2025-09-01', inventory_status: 'NEAR_EXPIRY', inventory_status_label: 'Near Expiry' },
];

beforeEach(() => {
  client.get.mockResolvedValue({ data: ingredients });
});

test('loads live expired ingredients, searches them, and sorts by quantity', async () => {
  render(<IngredientStatusModal open onClose={jest.fn()} />);

  expect((await screen.findAllByText('Butter')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Coffee beans').length).toBeGreaterThan(0);
  expect(screen.queryByText('Fresh milk')).not.toBeInTheDocument();
  expect(client.get).toHaveBeenCalledWith('/api/inventory/ingredients/', { params: { limit: 300, offset: 0 } });

  fireEvent.change(screen.getByRole('textbox', { name: 'Search expired ingredients' }), { target: { value: 'butter' } });
  expect(screen.getAllByText('Butter').length).toBeGreaterThan(0);
  expect(screen.queryByText('Coffee beans')).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox', { name: 'Sort expired ingredients' }), { target: { value: 'quantity_asc' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search expired ingredients' }), { target: { value: '' } });
  await waitFor(() => {
    const tableRows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(tableRows[1]).getByText('Butter')).toBeInTheDocument();
    expect(within(tableRows[1]).getByText('4.5')).toBeInTheDocument();
  });
  expect(screen.getAllByText('g').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
  expect(screen.getByRole('table').parentElement).toHaveClass('hidden', 'md:block');
  expect(document.querySelector('[class*="md:hidden"]')).toBeInTheDocument();
});

test('shows an empty state when the inventory has no expired ingredients and closes on request', async () => {
  client.get.mockResolvedValue({ data: [] });
  const onClose = jest.fn();
  render(<IngredientStatusModal open onClose={onClose} />);

  expect(await screen.findByText('No expired ingredients')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('loads every page from the inventory endpoint before filtering expired rows', async () => {
  const firstPage = Array.from({ length: 300 }, (_, id) => ({
    id, name: `Ingredient ${id}`, stock_quantity: '1.00', base_unit: 'G',
    expiration_date: '2025-01-01', inventory_status: 'EXPIRED', inventory_status_label: 'Expired',
  }));
  client.get.mockImplementation((_url, { params }) => Promise.resolve({ data: params.offset === 0 ? firstPage : [{ ...ingredients[0], id: 1000, name: 'Overflow ingredient' }] }));
  render(<IngredientStatusModal open onClose={jest.fn()} />);

  expect(await screen.findByText('Showing 301 of 301 expired ingredients')).toBeInTheDocument();
  expect(client.get).toHaveBeenNthCalledWith(1, '/api/inventory/ingredients/', { params: { limit: 300, offset: 0 } });
  expect(client.get).toHaveBeenNthCalledWith(2, '/api/inventory/ingredients/', { params: { limit: 300, offset: 300 } });
});

test('shows ingredients matching a non-expired stock status', async () => {
  render(<IngredientStatusModal open onClose={jest.fn()} statusKey="NEAR_EXPIRY" statusLabel="Near Expiry" />);

  expect(await screen.findByRole('heading', { name: 'Near Expiry Ingredients' })).toBeInTheDocument();
  expect((await screen.findAllByText('Fresh milk')).length).toBeGreaterThan(0);
  expect(screen.queryByText('Coffee beans')).not.toBeInTheDocument();
  expect(screen.getAllByText('Near Expiry').length).toBeGreaterThan(0);
});
