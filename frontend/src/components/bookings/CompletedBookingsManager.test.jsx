import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../../api/client';
import CompletedBookingsManager from './CompletedBookingsManager';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

const completedBooking = {
  id: 88,
  status: 'COMPLETED',
  customer_id: 4,
  customer_name: 'Morgan Lee',
  customer_email: 'morgan@example.test',
  scheduled_date: '2026-10-20',
  scheduled_time: '14:00:00',
  package: 3,
  package_details: { name: 'Studio Portrait' },
  photo_attachments: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  client.get.mockResolvedValue({ data: { count: 1, next_offset: null, results: [completedBooking] } });
});

test('admin can upload multiple images and gets progress and success feedback', async () => {
  client.post.mockImplementation(async (_url, _formData, config) => {
    config.onUploadProgress?.({ loaded: 100, total: 100 });
    return { data: { count: 2, results: [
      { id: 101, attachment_type: 'IMAGE', title: 'Portrait set', file_name: 'one.png' },
      { id: 102, attachment_type: 'IMAGE', title: 'Portrait set', file_name: 'two.png' },
    ] } };
  });

  render(<CompletedBookingsManager />);
  expect(await screen.findByText('Morgan Lee')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Attach Photos' }));
  const fileInput = screen.getByLabelText(/Session photos/);
  fireEvent.change(fileInput, { target: { files: [
    new File(['one'], 'one.png', { type: 'image/png' }),
    new File(['two'], 'two.png', { type: 'image/png' }),
  ] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload & Deliver' }));

  expect(await screen.findByRole('status')).toHaveTextContent('2 photos delivered to the customer.');
  const [url, formData, config] = client.post.mock.calls[0];
  expect(url).toBe('/api/gallery/customer-photos/');
  expect(formData.get('booking')).toBe('88');
  expect(formData.get('attachment_type')).toBe('IMAGE');
  expect(formData.getAll('images')).toHaveLength(2);
  expect(config.onUploadProgress).toEqual(expect.any(Function));
  await waitFor(() => expect(screen.getByText('Delivered attachments · 2')).toBeInTheDocument());
});

test('admin sees a clear error when an attachment upload fails', async () => {
  client.post.mockRejectedValue(new Error('upload failed'));
  render(<CompletedBookingsManager />);
  await screen.findByText('Morgan Lee');
  fireEvent.click(screen.getByRole('button', { name: 'Attach Photos' }));
  fireEvent.change(screen.getByLabelText(/Session photos/), {
    target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload & Deliver' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The photo attachment could not be uploaded. Please try again.');
});
