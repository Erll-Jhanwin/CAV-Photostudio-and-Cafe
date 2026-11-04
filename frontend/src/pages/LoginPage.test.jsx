import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from './LoginPage';
import client from '../api/client';

const mockLogin = jest.fn();
const mockLoginWithGoogle = jest.fn();
const mockRegister = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, loginWithGoogle: mockLoginWithGoogle, register: mockRegister }),
}));

jest.mock('../components/RecaptchaChallenge', () => {
  const React = require('react');
  return function MockRecaptchaChallenge({ onTokenChange, resetKey }) {
    React.useEffect(() => onTokenChange('test-recaptcha-token', ''), [onTokenChange, resetKey]);
    return React.createElement('div', { 'data-testid': 'recaptcha-widget', 'data-reset-key': resetKey });
  };
});

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  getApiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}));

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => jest.requireActual('react').createElement('a', { href: to, ...props }, children),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams()],
}));

const renderLogin = () => render(<LoginPage />);
const appearsBefore = (first, second) => {
  // Assert source order for responsive form placement.
  // eslint-disable-next-line testing-library/no-node-access
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
};

describe('responsive authentication layout', () => {
  test('hides the marketing panel below desktop while login and registration share a full-width form', () => {
    renderLogin();

    // The section elements carry the responsive layout classes under test.
    const marketingPanelHeading = screen.getByRole('heading', {
      name: 'Welcome to your CAV experience.',
    });
    // eslint-disable-next-line testing-library/no-node-access
    const marketingPanel = marketingPanelHeading.closest('section');
    // eslint-disable-next-line testing-library/no-node-access
    const loginForm = screen.getByRole('heading', { name: 'Sign in to CAV' }).closest('section');

    expect(marketingPanel).toHaveClass('hidden', 'lg:flex');
    expect(loginForm).toHaveClass('min-w-0', 'bg-cream');
    // eslint-disable-next-line testing-library/no-node-access
    expect(loginForm.querySelector('.max-w-md')).toHaveClass('w-full', 'min-w-0');

    const loginPassword = screen.getByLabelText('Password');
    expect(screen.getByLabelText('Username')).toHaveAttribute('name', 'username');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(loginPassword).toHaveAttribute('name', 'password');
    expect(loginPassword).toHaveAttribute('autocomplete', 'current-password');
    const forgotLink = screen.getByRole('button', { name: 'Forgot password?' });
    const loginRecaptcha = screen.getByTestId('recaptcha-widget');
    const loginSubmit = screen.getByRole('button', { name: 'Log in' });
    expect(appearsBefore(loginPassword, forgotLink)).toBe(true);
    expect(appearsBefore(forgotLink, loginRecaptcha)).toBe(true);
    expect(appearsBefore(loginRecaptcha, loginSubmit)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'New to CAV? Create an account' }));

    expect(screen.getByRole('heading', { name: 'Join CAV today' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to your CAV experience.' })).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access
    expect(screen.getByRole('heading', { name: 'Join CAV today' }).closest('section').querySelector('.max-w-2xl')).toHaveClass('w-full', 'min-w-0');
    const registrationPassword = screen.getByLabelText('Password');
    const registrationRecaptcha = screen.getByTestId('recaptcha-widget');
    const consentCheckbox = screen.getByRole('checkbox');
    expect(appearsBefore(registrationPassword, registrationRecaptcha)).toBe(true);
    expect(appearsBefore(registrationRecaptcha, consentCheckbox)).toBe(true);
  });
});

describe('password authentication submissions', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockRegister.mockReset();
    mockNavigate.mockReset();
    client.post.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('login submits only after the reCAPTCHA widget is in the form and its token is available', async () => {
    mockLogin.mockResolvedValue({ success: false, error: 'Invalid credentials.' });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'MemberPassword#2026' } });

    // The mocked auth promise triggers state updates after the click.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('member', 'MemberPassword#2026', {
      recaptcha_token: 'test-recaptcha-token',
    }));
  });

  test('submits credentials populated by browser autofill even when React has not observed input events', async () => {
    mockLogin.mockResolvedValue({ success: false, error: 'Invalid username or password.' });
    renderLogin();
    const username = screen.getByLabelText('Username');
    const password = screen.getByLabelText('Password');
    username.value = 'autofilled-member';
    password.value = 'AutofilledPassword#2026';

    const submit = screen.getByRole('button', { name: 'Log in' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('autofilled-member', 'AutofilledPassword#2026', {
      recaptcha_token: 'test-recaptcha-token',
    }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
  });

  test.each([
    ['ADMIN', '/admin'],
    ['STAFF', '/staff'],
    ['CUSTOMER', '/customer'],
  ])('routes an authenticated %s account to %s', async (role, destination) => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { id: 7, username: 'member', role },
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});
    renderLogin();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'MemberPassword#2026' } });

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(destination));
  });

  test('a rejected login token resets the widget so the next attempt requires a fresh challenge', async () => {
    mockLogin.mockResolvedValue({
      success: false,
      error: 'The security check expired or was already used. Complete it again and retry.',
    });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'MemberPassword#2026' } });

    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      await Promise.resolve();
    });

    expect(await screen.findByText(/security check expired or was already used/i)).toBeInTheDocument();
    expect(mockLogin).toHaveBeenCalledWith('member', 'MemberPassword#2026', {
      recaptcha_token: 'test-recaptcha-token',
    });
    await waitFor(() => expect(screen.getByTestId('recaptcha-widget')).toHaveAttribute('data-reset-key', '1'));
  });

  test('admin SMS verification submits only the challenge and code, then shows the OTP error', async () => {
    mockLogin
      .mockResolvedValueOnce({
        mfaRequired: true,
        mfa_token: 'admin-mfa-token',
        mfa_method: 'sms',
        contact_hint: '*******4567',
        resend_cooldown_seconds: 60,
        expires_in_minutes: 10,
      })
      .mockResolvedValueOnce({ success: false, error: 'Invalid or expired admin verification code.' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'AdminPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/Admin SMS verification code sent/)).toBeInTheDocument();
    expect(screen.queryByText('Complete the security check, then try again.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('SMS one-time code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Admin Access' }));

    expect(await screen.findByText('Invalid or expired admin verification code.')).toBeInTheDocument();
    expect(mockLogin).toHaveBeenNthCalledWith(2, 'admin', 'AdminPass123!', {
      mfa_token: 'admin-mfa-token',
      mfa_code: '000000',
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('registration keeps privacy consent required and submits the reCAPTCHA token after consent', async () => {
    mockRegister.mockResolvedValue({
      success: true,
      registration_token: 'registration-token-with-more-than-32-characters',
      contact_hint: '*******4567',
      resend_cooldown_seconds: 60,
      expires_in_minutes: 10,
    });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'New to CAV? Create an account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-member' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecureCustomer#2026' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'SecureCustomer#2026' } });

    const submit = screen.getByRole('button', { name: 'Send Verification Code' });
    expect(submit).toBeDisabled();
    expect(mockRegister).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    // Registration transitions to the OTP form after its mocked async result.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
      username: 'new-member',
      privacy_consent: true,
      recaptcha_token: 'test-recaptcha-token',
    })));
    expect(await screen.findByLabelText('One-Time OTP')).toBeInTheDocument();
  });

  test('a rejected registration token resets the widget and keeps the retry message visible', async () => {
    mockRegister.mockResolvedValue({
      success: false,
      errors: { detail: 'The security check expired or was already used. Complete it again and retry.' },
    });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'New to CAV? Create an account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-member' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecureCustomer#2026' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'SecureCustomer#2026' } });
    fireEvent.click(screen.getByRole('checkbox'));

    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
      await Promise.resolve();
    });

    expect(await screen.findByText(/The security check expired or was already used/i)).toBeInTheDocument();
    expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ recaptcha_token: 'test-recaptcha-token' }));
    await waitFor(() => expect(screen.getByTestId('recaptcha-widget')).toHaveAttribute('data-reset-key', '1'));
  });
});

describe('Google registration', () => {
  beforeEach(() => {
    mockLoginWithGoogle.mockReset();
  });

  test.each([['desktop', 1280], ['mobile', 390]])('keeps a verified Google registration active on %s while the customer corrects a mobile number and accepts consent', async (_device, viewportWidth) => {
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
      .mockResolvedValueOnce({ success: false, error: 'Add a valid Philippine mobile number to continue.', errors: {
        phone_number: 'A valid Philippine mobile number is required.',
        google_registration_required: true,
        google_profile: { email: 'google@example.com', first_name: 'Google', last_name: 'Customer', phone_number: '' },
      } })
      .mockResolvedValueOnce({ success: true, created: true, user: { id: 91, username: 'google.customer', email: 'google@example.com', role: 'CUSTOMER' } });

    try {
      window.innerWidth = viewportWidth;
      window.dispatchEvent(new Event('resize'));
      renderLogin();
      await waitFor(() => expect(googleCallback).toBeDefined());
      await act(async () => { googleCallback({ credential: 'verified-google-id-token' }); });

      await screen.findByLabelText('Mobile number');
      expect(screen.getByText('Use 11 digits starting with 09, e.g., 09876543122.')).toBeInTheDocument();
      expect(screen.getByText('A valid Philippine mobile number is required.')).toBeInTheDocument();
      expect(screen.getByText('google@example.com is verified. Your Google sign-in is saved while you finish this step.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09876543abc' } });
      expect(screen.getByLabelText('Mobile number')).toHaveValue('09876543abc');
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByText('Use 11 digits starting with 09 (example: 09876543122). Do not enter letters, spaces, or symbols.')).toBeInTheDocument();
      expect(mockLoginWithGoogle).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09876543122' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalledTimes(2));
      expect(mockLoginWithGoogle).toHaveBeenNthCalledWith(1, 'verified-google-id-token', '', { privacy_consent: false, recaptcha_token: 'test-recaptcha-token' });
      expect(mockLoginWithGoogle).toHaveBeenNthCalledWith(2, 'verified-google-id-token', '09876543122', { privacy_consent: true, recaptcha_token: 'test-recaptcha-token' });
      expect(window.alert).toHaveBeenCalledWith('Welcome, google.customer.');
    } finally {
      if (originalClientId === undefined) delete process.env.REACT_APP_GOOGLE_CLIENT_ID;
      else process.env.REACT_APP_GOOGLE_CLIENT_ID = originalClientId;
      window.alert = originalAlert;
      delete window.google;
    }
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
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/Admin SMS verification code sent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 1s' })).toBeDisabled();

    await act(async () => { jest.advanceTimersByTime(1100); });
    const resendButton = await screen.findByRole('button', { name: 'Resend code' });
    expect(resendButton).toBeEnabled();
    fireEvent.change(screen.getByLabelText('SMS one-time code'), { target: { value: '123456' } });
    fireEvent.click(resendButton);

    expect(await screen.findByText(/A new admin verification code was sent/)).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/api/auth/login/mfa/resend/', { mfa_token: 'admin-mfa-token' });
    expect(screen.queryByTestId('recaptcha-widget')).not.toBeInTheDocument();
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
      // MFA verification changes component state after the mocked auth promise.
      // eslint-disable-next-line testing-library/no-unnecessary-act
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
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ recaptcha_token: 'test-recaptcha-token' })));
    expect(await screen.findByLabelText('One-Time OTP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 1s' })).toBeDisabled();

    await act(async () => { jest.advanceTimersByTime(1100); });
    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    fireEvent.change(screen.getByLabelText('One-Time OTP'), { target: { value: '123456' } });
    // The resend handler clears the old OTP after its mocked async response.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.click(resendButton);
      await Promise.resolve();
    });

    expect(await screen.findByText(/A new verification code was sent/)).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/api/auth/register/resend/', {
      registration_token: 'registration-token-with-more-than-32-characters',
      recaptcha_token: 'test-recaptcha-token',
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
    // The resend handler resets the OTP field after its mocked async response.
    // eslint-disable-next-line testing-library/no-unnecessary-act
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
