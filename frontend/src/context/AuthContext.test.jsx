import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import client, { clearStoredAuth } from '../api/client';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
  beginAuthTransition: jest.fn(),
  clearStoredAuth: jest.fn(),
  getApiErrorMessage: jest.fn((error, fallback) => fallback),
}));

function AuthProbe() {
  const { loading, user, login } = useAuth();

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.username || 'signed-out'}</span>
      <button type="button" onClick={() => void login('customer', 'Customer123!')}>
        Sign in
      </button>
    </div>
  );
}

const renderAuthProbe = () => render(
  <AuthProvider>
    <AuthProbe />
  </AuthProvider>,
);

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    client.get.mockReset();
    client.post.mockReset();
    clearStoredAuth.mockReset();
  });

  test('does not complete login until the cookie-authenticated profile succeeds', async () => {
    client.post.mockResolvedValue({
      data: {
        id: 7,
        username: 'customer',
        email: 'customer@example.com',
        role: 'CUSTOMER',
      },
    });
    client.get.mockResolvedValue({
      data: {
        id: 7,
        username: 'customer',
        email: 'customer@example.com',
        role: 'CUSTOMER',
      },
    });

    renderAuthProbe();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('customer'));
    expect(client.get).toHaveBeenCalledWith('/api/auth/profile/', { skipAuthRedirect: true });
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({
      username: 'customer',
      role: 'CUSTOMER',
    });
  });

  test('does not let an older session restore response erase a newer login', async () => {
    localStorage.setItem('user', JSON.stringify({
      id: 3,
      username: 'old-user',
      email: 'old@example.com',
      role: 'CUSTOMER',
    }));

    let rejectRestore;
    const restoreRequest = new Promise((resolve, reject) => {
      void resolve;
      rejectRestore = reject;
    });
    let profileCall = 0;
    client.get.mockImplementation(() => {
      profileCall += 1;
      return profileCall === 1
        ? restoreRequest
        : Promise.resolve({
          data: {
            id: 7,
            username: 'new-user',
            email: 'new@example.com',
            role: 'STAFF',
          },
        });
    });
    client.post.mockResolvedValue({
      data: {
        id: 7,
        username: 'new-user',
        email: 'new@example.com',
        role: 'STAFF',
      },
    });

    renderAuthProbe();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('new-user'));

    rejectRestore({ response: { status: 401 } });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('new-user'));
    expect(clearStoredAuth).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({
      username: 'new-user',
      role: 'STAFF',
    });
  });
});
