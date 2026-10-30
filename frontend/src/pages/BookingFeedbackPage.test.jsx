import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../api/client';
import BookingFeedbackPage from './BookingFeedbackPage';
const mockUseSearchParams = jest.fn();

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => jest.requireActual('react').createElement('a', { href: to, ...props }, children),
  useSearchParams: () => mockUseSearchParams(),
}));

describe('BookingFeedbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchParams.mockImplementation(() => [new URLSearchParams(window.location.search)]);
  });

  test('loads the booking survey and saves its rating and optional comment', async () => {
    client.get.mockResolvedValue({ data: { booking_id: 28, service: 'Studio Session', package: 'Portrait', already_submitted: false } });
    client.post.mockResolvedValue({ data: { id: 4 } });
    window.history.replaceState({}, '', '/booking-feedback?token=signed-token');
    render(<BookingFeedbackPage />);

    expect(await screen.findByText(/Studio Session · Portrait/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.change(screen.getByLabelText('Comments (optional)'), { target: { value: 'Lovely visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/reviews/survey/', {
      token: 'signed-token', rating: 5, feedback: 'Lovely visit',
    }));
    expect(await screen.findByText('Thank you for your feedback')).toBeInTheDocument();
  });

  test('shows a useful message for an expired survey link', async () => {
    client.get.mockRejectedValue({ response: { data: { detail: 'This feedback link is invalid or no longer available.' } } });
    window.history.replaceState({}, '', '/booking-feedback?token=expired');
    render(<BookingFeedbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This feedback link is invalid or no longer available.');
  });
});
