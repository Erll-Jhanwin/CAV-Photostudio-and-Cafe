import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../api/client';
import PaymentProofPreview from './PaymentProofPreview';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  getApiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}));

const payment = { id: 18, booking: 48, receipt_url: '/api/bookings/payments/18/receipt/' };

describe('PaymentProofPreview', () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeAll(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:payment-proof');
    URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
    else delete URL.revokeObjectURL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:payment-proof');
    URL.revokeObjectURL = jest.fn();
  });

  test('fetches the proof only when requested, supports zoom, and revokes the object URL on close', async () => {
    let resolveRequest;
    client.get.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));
    render(<PaymentProofPreview payment={payment} />);

    expect(screen.getByRole('button', { name: 'View proof of payment for booking 48' })).toHaveTextContent('View Proof of Payment');
    expect(client.get).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View proof of payment for booking 48' }));
    expect(screen.getByRole('dialog', { name: 'Payment proof · Booking #48' })).toBeInTheDocument();
    expect(screen.getByText('Loading payment proof…')).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('/api/bookings/payments/18/receipt/', { responseType: 'blob' });

    await act(async () => resolveRequest({ data: new Blob(['proof'], { type: 'image/png' }) }));
    expect(await screen.findByRole('img', { name: 'Payment proof for booking 48' })).toHaveAttribute('src', 'blob:payment-proof');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in payment proof' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Payment proof for booking 48' })).toHaveStyle({ width: '125%' });

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:payment-proof'));
  });

  test('shows a clear missing-proof state without requesting storage when no proof is attached', async () => {
    render(<PaymentProofPreview payment={{ ...payment, receipt_url: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'View proof of payment for booking 48' }));

    expect(await screen.findByText('No payment proof attached')).toBeInTheDocument();
    expect(client.get).not.toHaveBeenCalled();
  });

  test('shows storage errors and allows retrying the same proof request', async () => {
    client.get
      .mockRejectedValueOnce({ response: { status: 503, data: { detail: 'Payment proof storage is temporarily unavailable.' } } })
      .mockResolvedValueOnce({ data: new Blob(['proof'], { type: 'image/png' }) });
    render(<PaymentProofPreview payment={payment} />);
    fireEvent.click(screen.getByRole('button', { name: 'View proof of payment for booking 48' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Payment proof storage is temporarily unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: 'Payment proof for booking 48' })).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  test('renders PDF proofs in the same modal', async () => {
    let resolveRequest;
    client.get.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));
    render(<PaymentProofPreview payment={payment} />);
    fireEvent.click(screen.getByRole('button', { name: 'View proof of payment for booking 48' }));

    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
    await act(async () => resolveRequest({ data: new Blob(['pdf'], { type: 'application/pdf' }) }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.createObjectURL.mock.results[0].value).toBe('blob:payment-proof');
    expect(await screen.findByTitle('Payment proof PDF for booking 48')).toBeInTheDocument();
  });
});
