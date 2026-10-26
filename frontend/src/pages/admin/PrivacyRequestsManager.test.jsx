import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PrivacyRequestsManager from './PrivacyRequestsManager';
import client from '../../api/client';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
  getApiErrorMessage: jest.fn((error, fallback) => error?.message || fallback),
}));

const privacyRequest = {
  id: 3,
  customer_name: 'Test Customer',
  customer_email: 'test@example.test',
  request_type: 'ACCESS',
  details: 'Please provide my account data.',
  status: 'OPEN',
  response_notes: '',
  created_at: '2026-10-20T10:00:00Z',
};

describe('PrivacyRequestsManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.get.mockResolvedValue({ data: [privacyRequest] });
    client.patch.mockResolvedValue({ data: { ...privacyRequest, status: 'COMPLETED' } });
  });

  test('loads a customer case and requires notes before completion', async () => {
    render(<PrivacyRequestsManager />);

    expect(await screen.findByText('Please provide my account data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a response note');
    expect(client.patch).not.toHaveBeenCalled();
  });

  test('marks a request in progress and records completion notes', async () => {
    render(<PrivacyRequestsManager />);
    await screen.findByText('Please provide my account data.');

    fireEvent.change(screen.getByLabelText('Review notes / action taken'), {
      target: { value: 'Verified identity and prepared the requested export.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark in progress' }));
    await waitFor(() => expect(client.patch).toHaveBeenCalledWith(
      '/api/privacy/requests/admin/3/',
      { status: 'IN_PROGRESS', response_notes: 'Verified identity and prepared the requested export.' },
    ));

    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(client.patch).toHaveBeenLastCalledWith(
      '/api/privacy/requests/admin/3/',
      { status: 'COMPLETED', response_notes: 'Verified identity and prepared the requested export.' },
    ));
  });
});
