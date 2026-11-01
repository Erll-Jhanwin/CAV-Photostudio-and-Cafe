import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BookingReceiptPrintDialog, { BookingReceiptDocument, bookingReceiptFromPayment } from './BookingReceipt';

const receipt = {
  bookingId: 55,
  customerName: 'Jamie Reyes',
  serviceName: 'Studio Portrait',
  packageName: 'Portrait Session',
  scheduledDate: '2026-12-01',
  scheduledTime: '09:00 AM',
  totalAmount: 1000,
  amountPaid: 500,
  currentPaymentAmount: 500,
  remainingBalance: 500,
  paymentStatus: 'Approved',
  paymentMethod: 'Cash',
};

test('booking receipt preview uses the 58 mm thermal layout and includes booking/payment details', () => {
  const { container } = render(<BookingReceiptDocument receipt={receipt} copyLabel="Customer Copy" />);
  const paper = container.querySelector('#booking-receipt-print-area');

  expect(paper).toHaveClass('w-[58mm]', 'font-mono');
  expect(screen.getByText('CAV PHOTO STUDIO & CAFE')).toBeInTheDocument();
  expect(screen.getByText('Customer Copy')).toBeInTheDocument();
  [
    'Booking reference', '#55', 'Customer', 'Jamie Reyes', 'Package', 'Portrait Session',
    'Session date', '2026-12-01', 'Session time', '09:00 AM', 'Total amount',
    'Remaining balance', 'Payment method', 'Cash',
    'Amount paid to date', 'Payment amount', 'Payment status', 'Approved',
  ].forEach(value => expect(screen.getByText(value)).toBeInTheDocument());
  expect(screen.getByText('PHP 1,000.00')).toBeInTheDocument();
  expect(screen.getAllByText('PHP 500.00')).toHaveLength(3);
});

test('verified booking receipt uses the approved payment and remaining balance returned by the API', () => {
  const mapped = bookingReceiptFromPayment({
    booking: 55,
    amount: '200.00',
    status: 'APPROVED',
    method: 'CASH',
    booking_details: {
      total_amount: '1000.00', amount_paid: '500.00', remaining_balance: '500.00',
      customer_name: 'Jamie Reyes', package_name: 'Portrait Session',
      scheduled_date: '2026-12-01', scheduled_time: '09:00 AM',
    },
  });
  expect(mapped).toMatchObject({ bookingId: 55, amountPaid: 500, currentPaymentAmount: 200, remainingBalance: 500, totalAmount: 1000, paymentStatus: 'Approved' });
});

test('verification receipt offers both copies and sends each through the local printer bridge', async () => {
  const localBridge = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ printed: true, printer: 'Thermal 58mm' }),
  });
  render(<BookingReceiptPrintDialog open receipt={receipt} printerName="Thermal 58mm" onClose={jest.fn()} />);

  await waitFor(() => expect(localBridge).toHaveBeenCalledTimes(1));
  const firstPrint = JSON.parse(localBridge.mock.calls[0][1].body);
  expect(firstPrint.printerName).toBe('Thermal 58mm');
  expect(firstPrint.content).toContain('STAFF/ADMIN COPY');

  fireEvent.click(screen.getByRole('button', { name: 'Print Customer Copy' }));
  await waitFor(() => expect(localBridge).toHaveBeenCalledTimes(2));
  expect(JSON.parse(localBridge.mock.calls[1][1].body).content).toContain('CUSTOMER COPY');
  expect(screen.getByText('Customer Copy')).toBeInTheDocument();

  localBridge.mockRestore();
});
