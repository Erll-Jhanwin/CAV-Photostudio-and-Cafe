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

function GoogleMFAProbe() {
  const { loginWithGoogle } = useAuth();
  const [result, setResult] = React.useState('');
  return (
    <div>
      <span data-testid="google-mfa-result">{result}</span>
      <button type="button" onClick={async () => {
        const response = await loginWithGoogle('google-id-token', '', {
          mfa_token: 'admin-mfa-token',
          mfa_code: '123456',
        });
        setResult(response.mfaRequired ? 'verification-required' : response.error || 'complete');
      }}>Verify Google admin</button>
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
    expect(client.get).toHaveBeenCalledWith('/api/auth/profile/', { skipAuthRedirect: true, timeout: 12000 });
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

  test('Google admin login forwards the resendable MFA challenge without completing a session', async () => {
    client.post.mockResolvedValue({
      data: {
        mfa_required: true,
        mfa_token: 'admin-mfa-token',
        mfa_method: 'sms',
        resend_cooldown_seconds: 60,
      },
    });

    render(<AuthProvider><GoogleMFAProbe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google admin' }));

    await waitFor(() => expect(screen.getByTestId('google-mfa-result')).toHaveTextContent('verification-required'));
    expect(client.post).toHaveBeenCalledWith('/api/auth/google/', {
      credential: 'google-id-token',
      phone_number: '',
      mfa_token: 'admin-mfa-token',
      mfa_code: '123456',
    });
    expect(client.get).not.toHaveBeenCalled();
  });
});
