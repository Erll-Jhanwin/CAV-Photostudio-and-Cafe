import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PosStockActionModal from './PosStockActionModal';

const products = [
  // ProductSerializer returns product-only rows without an item_type field.
  { id: 1, name: 'Americano', sku: 'AMER-01', is_active: true },
  { id: 2, name: 'Matcha', sku: 'MATCHA-01', is_active: true },
  { id: 3, name: 'Inactive Latte', item_type: 'PRODUCT', is_active: false },
  { id: 4, name: 'Milk', item_type: 'INGREDIENT', is_active: true },
];

const sale = {
  id: 11,
  customer_name: 'Taylor Smith',
  transaction_id: 'POS-20261029-001',
  completed_at: '2026-10-29T10:00:00Z',
  total: '185.00',
  payment_status: 'PAID',
  order_type: 'WALK_IN',
  items: [
    { product: 1, quantity: 2, returned_quantity: 0, wasted_quantity: 0, product_details: { name: 'Americano' } },
    { product: 2, quantity: 1, returned_quantity: 0, wasted_quantity: 0, product_details: { name: 'Matcha' } },
  ],
};

function renderModal(props = {}) {
  return render(<PosStockActionModal
    open actionType="WASTAGE" products={products}
    onSearchTransactions={jest.fn().mockResolvedValue([sale])}
    onLookupTransaction={jest.fn().mockResolvedValue(sale)}
    onSubmit={jest.fn()} onClose={jest.fn()}
    {...props}
  />);
}

async function fillReferenceAndReason() {
  fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'POS-20261029-001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load sale items' }));
  await waitFor(() => expect(screen.getByText(/Eligible products from POS-20261029-001/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Test workflow reason' } });
}

test('wastage modal searches products, adjusts and removes selected quantities, and submits a reason and transaction', async () => {
  const onSubmit = jest.fn();
  renderModal({ onSubmit });

  expect(screen.getByRole('button', { name: /Americano Add/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Matcha Add/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'matcha' } });
  expect(screen.getByRole('button', { name: /Matcha Add/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Americano Add/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: '' } });
  expect(screen.queryByRole('button', { name: /Inactive Latte Add/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'MATCHA-01' } });
  expect(screen.getByRole('button', { name: /Matcha Add/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: '' } });

  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Americano quantity' }));
  expect(screen.getByLabelText('Americano quantity')).toHaveValue(2);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Americano' }));
  expect(screen.getByText('0 selected')).toBeInTheDocument();

  await fillReferenceAndReason();
  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Americano quantity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Wastage' }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    action_type: 'WASTAGE',
    transaction_id: 'POS-20261029-001',
    reason: 'Test workflow reason',
    items: [{ product_id: 1, quantity: 2 }],
  });
  expect(onSubmit.mock.calls[0][0].idempotency_key).toMatch(/^pos-stock-action-/);
});

test('refund requires an explicit restock disposition and submits only the selected products', async () => {
  const onSubmit = jest.fn();
  renderModal({ actionType: 'REFUND', onSubmit });
  await fillReferenceAndReason();
  fireEvent.click(screen.getByRole('button', { name: /Matcha Add/ }));

  const submit = screen.getByRole('button', { name: 'Confirm Refund' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Matcha restock disposition'), { target: { value: 'RESTOCKED' } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    action_type: 'REFUND',
    transaction_id: 'POS-20261029-001',
    reason: 'Test workflow reason',
    items: [{ product_id: 2, quantity: 1, disposition: 'RESTOCKED' }],
  });
});

test('both actions stay disabled until a loaded transaction, reason, and a product are supplied', async () => {
  const onSubmit = jest.fn();
  renderModal({ onSubmit });
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'POS-20261029-001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load sale items' }));
  await waitFor(() => expect(screen.getByText(/Eligible products from POS-20261029-001/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Test workflow reason' } });
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeEnabled();
});

test('customer autocomplete distinguishes matching purchases, loads the selected sale, and clears it when the query changes', async () => {
  const secondSale = { ...sale, id: 12, transaction_id: 'POS-20261030-004', created_at: '2026-10-30T12:30:00Z', total: '420.00', items: [{ product: 2, quantity: 3, returned_quantity: 0, product_details: { name: 'Matcha' } }] };
  const onSearchTransactions = jest.fn().mockResolvedValue([sale, secondSale]);
  const onSubmit = jest.fn();
  renderModal({ onSearchTransactions, onSubmit });

  fireEvent.change(screen.getByLabelText('Search transactions by customer name'), { target: { value: 'Taylor' } });
  const suggestion = await screen.findByRole('option', { name: /Taylor Smith.*POS-20261030-004.*420\.00/ });
  expect(screen.getByRole('option', { name: /POS-20261029-001.*185\.00/ })).toBeInTheDocument();
  fireEvent.click(suggestion);

  await waitFor(() => expect(screen.getByLabelText('Transaction ID')).toHaveValue('POS-20261030-004'));
  expect(screen.getByRole('button', { name: /Matcha Add/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Americano Add/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search transactions by customer name'), { target: { value: 'Taylor S' } });
  expect(screen.getByLabelText('Transaction ID')).toHaveValue('');
  expect(screen.queryByText(/Eligible products from POS-20261030-004/)).not.toBeInTheDocument();
  expect(screen.getByText('0 selected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeDisabled();
});

test('product loading and failure have explicit status and retry states', () => {
  const onRetryProducts = jest.fn();
  const { rerender } = render(<PosStockActionModal open actionType="WASTAGE" loadingProducts products={[]} onSubmit={jest.fn()} onClose={jest.fn()} onRetryProducts={onRetryProducts} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading product list');

  rerender(<PosStockActionModal open actionType="REFUND" productError="Could not load products." products={[]} onSubmit={jest.fn()} onClose={jest.fn()} onRetryProducts={onRetryProducts} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load products.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry product list' }));
  expect(onRetryProducts).toHaveBeenCalledTimes(1);
});
