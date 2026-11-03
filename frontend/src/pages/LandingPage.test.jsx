import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';
import { getCached } from '../api/client';
import LandingPage from './LandingPage';

let mockUser = { id: 12, username: 'jamie', first_name: 'Jamie', role: 'CUSTOMER' };
const mockNavigate = jest.fn();
let mockBookings = [];

jest.mock('react-router-dom', () => {
  const ReactRuntime = require('react');
  return {
    Link: ({ to, children, ...props }) => ReactRuntime.createElement('a', { href: to, ...props }, children),
    useNavigate: () => mockNavigate,
  };
});

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../api/client', () => ({
  getCached: jest.fn(),
}));

jest.mock('axios', () => ({
  post: jest.fn(),
}));

const renderLanding = (user = mockUser, width = 1280) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  mockUser = user;
  return render(<LandingPage page="home" />);
};

beforeEach(() => {
  mockNavigate.mockReset();
  mockUser = { id: 12, username: 'jamie', first_name: 'Jamie', role: 'CUSTOMER' };
  mockBookings = [];
  window.scrollTo = jest.fn();
  getCached.mockImplementation(url => {
    if (url === '/api/bookings/') return Promise.resolve({ data: mockBookings });
    if (url === '/api/chatbot/faqs/') return Promise.resolve({ data: [] });
    if (url === '/api/gallery/images/') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

test('customer homepage greets by first name and opens the exact next booking', async () => {
  mockBookings = [
    { id: 45, status: 'CONFIRMED', scheduled_date: '2099-07-20', scheduled_time: '13:30:00', package_details: { name: 'Family Package', service: { name: 'Studio Session' } } },
    { id: 46, status: 'PENDING', scheduled_date: '2099-06-10', scheduled_time: '09:15:00', package_details: { name: 'Solo Package' } },
    { id: 47, status: 'CANCELLED', scheduled_date: '2099-05-01', scheduled_time: '09:00:00', package_details: { name: 'Cancelled Package' } },
  ];
  const { container } = renderLanding();

  expect(await screen.findByRole('heading', { name: /Capture the moment/ })).toHaveTextContent('Capture the moment, savor the flavor.');
  expect(screen.getByRole('article', { name: 'Your next booking' })).toHaveTextContent('Solo Package');
  expect(screen.getByRole('article', { name: 'Your next booking' })).toHaveTextContent('June 10, 2099');
  expect(screen.getByRole('article', { name: 'Your next booking' })).toHaveTextContent('9:15 AM');
  expect(container.querySelector('#hero')).toHaveClass('bg-gradient-to-br');
  expect(container.querySelector('#hero .grid')).toHaveClass('grid-cols-1', 'lg:grid-cols-12');
  expect(screen.getByRole('img', { name: 'Solo studio portrait' })).toHaveAttribute('src', '/assets/pics/solo/solo%20pic%20portrait.jpg');

  fireEvent.click(screen.getByRole('button', { name: 'View My Booking' }));
  expect(mockNavigate).toHaveBeenCalledWith('/customer?tab=history&booking=46');
});

test('Book Another Session opens the booking flow and the hero stacks at mobile width', async () => {
  mockBookings = [{ id: 52, status: 'CONFIRMED_DP', scheduled_date: '2099-08-05', scheduled_time: '11:00', package_details: { name: 'Birthday Package' } }];
  const { container } = renderLanding(mockUser, 390);
  await screen.findByRole('article', { name: 'Your next booking' });
  expect(container.querySelector('#hero .grid')).toHaveClass('grid-cols-1', 'lg:grid-cols-12');
  expect(screen.getByRole('group', { name: 'Choose a studio portrait' })).toHaveClass('grid-cols-3', 'lg:grid-cols-1');

  fireEvent.click(screen.getByRole('button', { name: 'Book Another Session' }));
  expect(mockNavigate).toHaveBeenCalledWith('/customer?tab=book');
});

test('guest can reserve a session and is sent to sign in', async () => {
  const { container } = renderLanding(null);
  fireEvent.click(await within(container.querySelector('#hero')).findByRole('button', { name: 'Start Your Studio Session' }));
  expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=book');
});

test('customer without an upcoming booking sees the reserve action', async () => {
  mockBookings = [{ id: 53, status: 'COMPLETED', scheduled_date: '2025-08-05', scheduled_time: '11:00', package_details: { name: 'Past Session' } }];
  const { container } = renderLanding();
  fireEvent.click(await within(container.querySelector('#hero')).findByRole('button', { name: 'Start Your Studio Session' }));
  expect(mockNavigate).toHaveBeenCalledWith('/customer');
});

test('Solo is selected by default and keyboard activation switches the preview to Couples', async () => {
  renderLanding(null);

  const preview = await screen.findByRole('img', { name: 'Solo studio portrait' });
  expect(preview).toHaveAttribute('src', '/assets/pics/solo/solo%20pic%20portrait.jpg');
  const solo = screen.getByRole('button', { name: 'Show Solo studio portrait' });
  const couples = screen.getByRole('button', { name: 'Show Couples studio portrait' });
  const friends = screen.getByRole('button', { name: 'Show Friends studio portrait' });
  expect(solo).toHaveAttribute('aria-pressed', 'true');
  expect(solo).toHaveClass('border-gold', 'ring-2');
  expect(couples).toHaveAttribute('aria-pressed', 'false');
  expect(friends).toHaveAttribute('aria-pressed', 'false');

  couples.focus();
  await userEvent.keyboard('{Enter}');

  expect(await screen.findByRole('img', { name: 'Couples portrait in the CAV studio' })).toHaveAttribute('src', '/assets/pics/couple/studio%20session%20couple-960w.webp');
  expect(couples).toHaveAttribute('aria-pressed', 'true');
  expect(couples).toHaveClass('border-gold', 'ring-2');
  expect(solo).toHaveAttribute('aria-pressed', 'false');
});

test('studio and café hero actions retain their destinations and all preview images exist locally', async () => {
  renderLanding(null);

  expect(await screen.findByRole('button', { name: 'Start Your Studio Session' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Explore Café Favorites' })).toHaveAttribute('href', '/cafe-menu');
  [
    'solo/solo pic portrait.jpg',
    'couple/studio session couple-960w.webp',
    'couple/studio session couple-480w.webp',
    'friends/studio session friends-960w.webp',
    'friends/studio session friends-480w.webp',
  ].forEach(asset => {
    expect(fs.existsSync(path.join(process.cwd(), 'public', 'assets', 'pics', asset))).toBe(true);
  });
});
