import React from 'react';
import { render, screen } from '@testing-library/react';
import client, { getCached } from '../api/client';

const mockStaffUser = { id: 2, username: 'staff', role: 'STAFF' };

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockStaffUser, logout: jest.fn() }),
}));

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  DATA_CHANGED_EVENT: 'cav:data-changed',
  getApiErrorMessage: (_error, fallback) => fallback,
  getCached: jest.fn(),
}));

jest.mock('../components/ui/StyledAlert', () => ({
  useStyledConfirm: () => jest.fn().mockResolvedValue(false),
}));

import StaffDashboard from './StaffDashboard';

const drinks = [
  { id: 18, name: 'Sparkling Green Apple', image_url: 'https://example.com/old-apple.jpg', price: '65.00', stock_level: 100, is_cafe_item: true },
  { id: 17, name: 'Sparkling Blueberry', image_url: 'https://example.com/old-blueberry.jpg', price: '75.00', stock_level: 100, is_cafe_item: true },
  { id: 15, name: 'Sparkling Mango', image_url: 'https://example.com/old-mango.jpg', price: '75.00', stock_level: 100, is_cafe_item: true },
  { id: 14, name: 'Strawberry Matcha', image_url: 'https://example.com/old-matcha.jpg', price: '145.00', stock_level: 100, is_cafe_item: true },
];

const expectedImages = {
  'Sparkling Blueberry': '/assets/pos-drinks/sparkling-blueberry.webp',
  'Sparkling Green Apple': '/assets/pos-drinks/sparkling-green-apple.webp',
  'Sparkling Mango': '/assets/pos-drinks/sparkling-mango.webp',
  'Strawberry Matcha': '/assets/pos-drinks/strawberry-matcha.webp',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('staff:recipesChecked', 'true');
  getCached.mockImplementation(url => Promise.resolve({ data: url === '/api/inventory/products/' ? drinks : [] }));
  client.get.mockImplementation(url => Promise.resolve({ data: url === '/api/auth/staff-access/me/' ? { on_duty: true } : {} }));
});

test.each([['mobile', 375], ['desktop', 1280]])('renders the correct POS drink images at %s viewport width', async (_viewport, width) => {
  window.innerWidth = width;
  render(<StaffDashboard />);

  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  await Promise.all(Object.keys(expectedImages).map(name => screen.findByRole('img', { name })));

  Object.entries(expectedImages).forEach(([name, imagePath]) => {
    const image = screen.getByRole('img', { name });
    expect(image.getAttribute('src')).toBe(imagePath);
    expect(image).toHaveClass('object-cover');
    expect(image.parentElement).toHaveClass('h-20', 'sm:h-24');
  });
});
