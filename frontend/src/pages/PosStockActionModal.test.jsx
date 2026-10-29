import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PosStockActionModal from './PosStockActionModal';

const products = [
  { id: 1, name: 'Americano', sku: 'AMER-01', item_type: 'PRODUCT', is_active: true },
  { id: 2, name: 'Matcha', sku: 'MATCHA-01', item_type: 'PRODUCT', is_active: true },
  { id: 3, name: 'Inactive Latte', item_type: 'PRODUCT', is_active: false },
  { id: 4, name: 'Milk', item_type: 'INGREDIENT', is_active: true },
];

function fillReferenceAndReason() {
  fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'POS-20261029-001' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Test workflow reason' } });
}

test('wastage modal searches products, adjusts and removes selected quantities, and submits a reason and transaction', () => {
  const onSubmit = jest.fn();
  render(<PosStockActionModal open actionType="WASTAGE" products={products} onSubmit={onSubmit} onClose={jest.fn()} />);

  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'matcha' } });
  expect(screen.getByRole('button', { name: /Matcha Add/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Americano Add/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: '' } });
  expect(screen.queryByRole('button', { name: /Inactive Latte Add/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Americano quantity' }));
  expect(screen.getByLabelText('Americano quantity')).toHaveValue(2);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Americano' }));
  expect(screen.getByText('0 selected')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase Americano quantity' }));
  fillReferenceAndReason();
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

test('refund requires an explicit restock disposition and submits only the selected products', () => {
  const onSubmit = jest.fn();
  render(<PosStockActionModal open actionType="REFUND" products={products} onSubmit={onSubmit} onClose={jest.fn()} />);
  fillReferenceAndReason();
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

test('both actions stay disabled until transaction, reason, and a product are supplied', () => {
  const onSubmit = jest.fn();
  render(<PosStockActionModal open actionType="WASTAGE" products={products} onSubmit={onSubmit} onClose={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Americano Add/ }));
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeDisabled();
  fillReferenceAndReason();
  expect(screen.getByRole('button', { name: 'Confirm Wastage' })).toBeEnabled();
});
