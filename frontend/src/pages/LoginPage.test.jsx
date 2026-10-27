import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from './LoginPage';
import client from '../api/client';

const mockLogin = jest.fn();
const mockLoginWithGoogle = jest.fn();
const mockRegister = jest.fn();

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, loginWithGoogle: mockLoginWithGoogle, register: mockRegister }),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  getApiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}));

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => jest.requireActual('react').createElement('a', { href: to, ...props }, children),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));

const renderLogin = () => render(<LoginPage />);

describe('responsive authentication layout', () => {
  test('hides the marketing panel below desktop while login and registration share a full-width form', () => {
    renderLogin();

    const marketingPanel = screen.getByRole('heading', {
      name: 'Welcome to your CAV experience.',
    }).closest('section');
    const loginForm = screen.getByRole('heading', { name: 'Sign in to CAV' }).closest('section');

    expect(marketingPanel).toHaveClass('hidden', 'lg:flex');
    expect(loginForm).toHaveClass('min-w-0', 'bg-cream');
    expect(loginForm.querySelector('.max-w-md')).toHaveClass('w-full', 'min-w-0');

    fireEvent.click(screen.getByRole('button', { name: 'New to CAV? Create an account' }));

    expect(screen.getByRole('heading', { name: 'Join CAV today' })).toBeInTheDocument();
    expect(marketingPanel).toHaveClass('hidden', 'lg:flex');
  });
});

describe('OTP resend flows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLogin.mockReset();
    mockLoginWithGoogle.mockReset();
    mockRegister.mockReset();
    client.post.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('admin MFA shows cooldown and requests a replacement SMS code', async () => {
    mockLogin.mockResolvedValue({
      mfaRequired: true,
      mfa_token: 'admin-mfa-token',
      mfa_method: 'sms',
      contact_hint: '*******4567',
      resend_cooldown_seconds: 1,
      expires_in_minutes: 10,
    });
    client.post.mockResolvedValue({ data: { detail: 'A new admin verification code was sent by SMS.', resend_cooldown_seconds: 60, expires_in_minutes: 10 } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'AdminPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter My Dashboard' }));
    expect(await screen.findByText(/Admin SMS verification code sent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 1s' })).toBeDisabled();

    await act(async () => { jest.advanceTimersByTime(1100); });
    const resendButton = await screen.findByRole('button', { name: 'Resend code' });
    expect(resendButton).toBeEnabled();
    fireEvent.change(screen.getByLabelText('SMS one-time code'), { target: { value: '123456' } });
    fireEvent.click(resendButton);

    expect(await screen.findByText(/A new admin verification code was sent/)).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/api/auth/login/mfa/resend/', { mfa_token: 'admin-mfa-token' });
    expect(screen.getByLabelText('SMS one-time code')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
  });

  test('Google admin MFA verifies through the Google-auth endpoint after resend', async () => {
    let googleCallback;
    const originalClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const originalAlert = window.alert;
    process.env.REACT_APP_GOOGLE_CLIENT_ID = 'google-client-id';
    window.alert = jest.fn();
    window.google = {
      accounts: {
        id: {
          initialize: jest.fn(({ callback }) => { googleCallback = callback; }),
          renderButton: jest.fn(),
        },
      },
    };
    mockLoginWithGoogle
      .mockResolvedValueOnce({
        mfaRequired: true,
        mfa_token: 'google-admin-mfa-token',
        mfa_method: 'sms',
        contact_hint: '*******4567',
        resend_cooldown_seconds: 1,
        expires_in_minutes: 10,
      })
      .mockResolvedValueOnce({ success: true, user: { username: 'google-admin', role: 'ADMIN' } });
    client.post.mockResolvedValue({ data: { detail: 'A new admin verification code was sent by SMS.', resend_cooldown_seconds: 60 } });

    try {
      renderLogin();
      await act(async () => { googleCallback({ credential: 'google-id-token' }); });
      expect(await screen.findByText(/Admin SMS verification code sent/)).toBeInTheDocument();

      await act(async () => { jest.advanceTimersByTime(1100); });
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
      expect(await screen.findByText(/A new admin verification code was sent/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('SMS one-time code'), { target: { value: '123456' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Verify Admin Access' })).toBeEnabled());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Verify Admin Access' }));
        await Promise.resolve();
      });

      await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalledTimes(2));
      expect(mockLoginWithGoogle).toHaveBeenLastCalledWith('google-id-token', '', {
        mfa_token: 'google-admin-mfa-token',
        mfa_code: '123456',
      });
      expect(mockLogin).not.toHaveBeenCalled();
    } finally {
      if (originalClientId === undefined) delete process.env.REACT_APP_GOOGLE_CLIENT_ID;
      else process.env.REACT_APP_GOOGLE_CLIENT_ID = originalClientId;
      window.alert = originalAlert;
      delete window.google;
    }
  });

  test('registration resend regenerates the SMS OTP after the displayed cooldown', async () => {
    mockRegister.mockResolvedValue({
      success: true,
      registration_token: 'registration-token-with-more-than-32-characters',
      contact_hint: '*******4567',
      resend_cooldown_seconds: 1,
      expires_in_minutes: 10,
    });
    client.post.mockResolvedValue({
      data: {
        message: 'A new verification code was sent.',
        contact_hint: '*******4567',
        resend_cooldown_seconds: 60,
        expires_in_minutes: 10,
      },
    });
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'New to CAV? Create an account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-customer' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecureCustomer#2026' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'SecureCustomer#2026' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    expect(await screen.findByLabelText('One-Time OTP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 1s' })).toBeDisabled();

    await act(async () => { jest.advanceTimersByTime(1100); });
    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    fireEvent.change(screen.getByLabelText('One-Time OTP'), { target: { value: '123456' } });
    fireEvent.click(resendButton);

    expect(await screen.findByText(/A new verification code was sent/)).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/api/auth/register/resend/', {
      registration_token: 'registration-token-with-more-than-32-characters',
    });
    expect(screen.getByLabelText('One-Time OTP')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
  });

  test('password reset resend uses the same provider request and clears the superseded code', async () => {
    client.post
      .mockResolvedValueOnce({ data: { detail: 'If that number is registered, a code was requested.', resend_cooldown_seconds: 1 } })
      .mockResolvedValueOnce({ data: { detail: 'If that number is registered, a code was requested.', resend_cooldown_seconds: 60 } });
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Registered Mobile Number'), { target: { value: '09171234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByLabelText('One-Time OTP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 1s' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('One-Time OTP'), { target: { value: '123456' } });

    await act(async () => { jest.advanceTimersByTime(1100); });
    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    await act(async () => {
      fireEvent.click(resendButton);
      await Promise.resolve();
    });

    expect(client.post).toHaveBeenCalledTimes(2);
    expect(client.post).toHaveBeenLastCalledWith('/api/auth/forgot-password/', { phone_number: '09171234567' });
    expect(screen.getByLabelText('One-Time OTP')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
  });
});
