import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import {
  Camera,
  Key,
  Mail,
  User,
  ShieldAlert,
  ArrowLeft,
  Eye,
  EyeOff,
  RefreshCw,
  Phone,
  CheckCircle2,
  Coffee,
  CalendarCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { PasswordStrength } from '../components/ui/PasswordStrength';
import client, { getApiErrorMessage } from '../api/client';
import {
  getConfirmPasswordError,
  getEmailError,
  getPasswordError,
  getPhilippineMobileError,
  getRequiredError,
  isBlank,
} from '../utils/validation';

// OAuth client IDs identify an app; unlike a client secret they are safe in a
// native bundle. Appflow builds do not receive the ignored frontend/.env file.
const NATIVE_GOOGLE_WEB_CLIENT_ID = '22100729214-a9qrjd5vlvad0crt754f236968rrb3m8.apps.googleusercontent.com';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithGoogle, register } = useAuth();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [isRegister, setIsRegister] = useState(false);
  const [registerStep, setRegisterStep] = useState('details');
  const [registrationToken, setRegistrationToken] = useState('');
  const [registrationContactHint, setRegistrationContactHint] = useState('');
  const [registrationOtp, setRegistrationOtp] = useState('');
  const [registrationResendCooldown, setRegistrationResendCooldown] = useState(0);
  const [registrationOtpExpiresMinutes, setRegistrationOtpExpiresMinutes] = useState(10);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [adminMfaStep, setAdminMfaStep] = useState(false);
  const [adminMfaToken, setAdminMfaToken] = useState('');
  const [adminMfaContactHint, setAdminMfaContactHint] = useState('');
  const [adminMfaOtp, setAdminMfaOtp] = useState('');
  const [adminMfaProvider, setAdminMfaProvider] = useState('password');
  const [adminMfaGoogleCredential, setAdminMfaGoogleCredential] = useState('');
  const [adminMfaResendCooldown, setAdminMfaResendCooldown] = useState(0);
  const [adminMfaOtpExpiresMinutes, setAdminMfaOtpExpiresMinutes] = useState(10);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState('phone');
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotPasswordConfirm, setForgotPasswordConfirm] = useState('');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState(null);
  const [forgotResendCooldown, setForgotResendCooldown] = useState(0);
  const [forgotOtpExpiresMinutes, setForgotOtpExpiresMinutes] = useState(10);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [forgotErrors, setForgotErrors] = useState({});
  const [googleReady, setGoogleReady] = useState(!Capacitor.isNativePlatform());
  const [googleInitError, setGoogleInitError] = useState('');
  const googleButtonRef = useRef(null);
  const isNativeApp = Capacitor.isNativePlatform();
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID
    || (isNativeApp ? NATIVE_GOOGLE_WEB_CLIENT_ID : '');

  const [form, setForm] = useState({
    username: '', password: '', passwordConfirm: '', email: '',
    firstName: '', lastName: '', phone: '', address: '',
  });

  const update = (field) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: '' }));
  };

  const validateLoginForm = (values = form) => {
    const errors = {
      username: getRequiredError(values.username, 'Username'),
      password: getRequiredError(values.password, 'Password'),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const validateRegisterForm = (values = form) => {
    const errors = {
      username: getRequiredError(values.username, 'Username'),
      email: getEmailError(values.email, { required: true }),
      phone: getPhilippineMobileError(values.phone),
      password: getPasswordError(values.password),
      passwordConfirm: getConfirmPasswordError(values.password, values.passwordConfirm),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const validateForgotForm = () => {
    if (forgotStep === 'phone') {
      const phone = getPhilippineMobileError(forgotPhone);
      return phone ? { phone } : {};
    }
    if (forgotStep === 'otp') {
      const otp = forgotOtp.length === 6 ? '' : 'Enter the 6-digit OTP.';
      return otp ? { otp } : {};
    }
    const errors = {
      password: getPasswordError(forgotPassword, 'New password'),
      passwordConfirm: getConfirmPasswordError(forgotPassword, forgotPasswordConfirm),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const isLoginValid = adminMfaStep
    ? adminMfaToken && adminMfaOtp.length === 6
    : !isBlank(form.username) && !isBlank(form.password);
  const isRegisterValid = registerStep === 'otp'
    ? registrationOtp.length === 6 && registrationConsent
    : !Object.keys(validateRegisterForm()).length && registrationConsent;
  const isForgotValid = !Object.keys(validateForgotForm()).length;

  const navigateAfterAuth = useCallback((authUser) => {
    if (redirect === 'book') { navigate('/customer'); return; }
    if (authUser.role === 'ADMIN') navigate('/admin');
    else if (authUser.role === 'STAFF') navigate('/staff');
    else navigate('/customer');
  }, [navigate, redirect]);

  const showLoginSuccess = (authUser) => {
    const displayName = authUser?.username || authUser?.email || 'User';
    window.alert(`${displayName} logged in successfully.`);
  };

  const completeGoogleLogin = useCallback(async (credential) => {
    if (!credential) {
      setError('Google did not return a sign-in token. Please try again.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await loginWithGoogle(credential, isRegister ? form.phone : '');
    setLoading(false);
    if (res.pendingVerification) {
      setIsRegister(true);
      setRegisterStep('otp');
      setRegistrationToken(res.registration_token || '');
      setRegistrationContactHint(res.contact_hint || 'your mobile number');
      setRegistrationOtp('');
      setRegistrationResendCooldown(res.resend_cooldown_seconds || 60);
      setRegistrationOtpExpiresMinutes(res.expires_in_minutes || 10);
      setRegistrationConsent(false);
      setSuccess(`We sent an SMS verification code to ${res.contact_hint || 'your mobile number'}. Enter it to finish creating your account.`);
      setFormErrors({});
    } else if (res.mfaRequired) {
      const contactHint = String(res.contact_hint || 'your registered mobile number');
      setAdminMfaStep(true);
      setAdminMfaToken(res.mfa_token || '');
      setAdminMfaContactHint(contactHint);
      setAdminMfaOtp('');
      setAdminMfaProvider('google');
      setAdminMfaGoogleCredential(credential);
      setAdminMfaResendCooldown(res.resend_cooldown_seconds || 60);
      setAdminMfaOtpExpiresMinutes(res.expires_in_minutes || 10);
      setSuccess(`Admin SMS verification code sent to ${contactHint}.`);
      setFormErrors({});
    } else if (res.success) {
      showLoginSuccess(res.user);
      navigateAfterAuth(res.user);
    } else {
      if (res.errors?.phone_number) {
        setFormErrors({ phone: Array.isArray(res.errors.phone_number) ? res.errors.phone_number.join(' ') : res.errors.phone_number });
      }
      setError(res.error);
    }
  }, [form.phone, isRegister, loginWithGoogle, navigateAfterAuth]);

  useEffect(() => {
    if (!googleClientId) return undefined;

    let cancelled = false;

    if (isNativeApp) {
      setGoogleReady(false);
      setGoogleInitError('');
      SocialLogin.initialize({
        google: {
          webClientId: googleClientId,
          mode: 'online',
        },
      })
        .then(() => {
          if (!cancelled) setGoogleReady(true);
        })
        .catch((initError) => {
          if (cancelled) return;
          console.error('Native Google login initialization failed:', initError);
          setGoogleInitError('Google sign-in is unavailable on this device. Please use your username and password.');
        });

      return () => {
        cancelled = true;
      };
    }

    if (!googleButtonRef.current) return undefined;

    const renderGoogleButton = () => {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => completeGoogleLogin(response?.credential),
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: isRegister ? 'signup_with' : 'signin_with',
        shape: 'pill',
        width: googleButtonRef.current.offsetWidth || 360,
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
    } else {
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        existingScript.addEventListener('load', renderGoogleButton, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = renderGoogleButton;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [completeGoogleLogin, googleClientId, isNativeApp, isRegister]);

  const handleNativeGoogleLogin = async () => {
    if (!googleReady || loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const response = await SocialLogin.login({
        provider: 'google',
        options: { scopes: ['profile', 'email'] },
      });
      const credential = response.provider === 'google' && response.result.responseType === 'online'
        ? response.result.idToken
        : null;
      if (!credential) {
        setError('Google did not return a sign-in token. Please try again.');
        return;
      }
      const res = await loginWithGoogle(credential, isRegister ? form.phone : '');
      if (res.pendingVerification) {
        setIsRegister(true);
        setRegisterStep('otp');
        setRegistrationToken(res.registration_token || '');
        setRegistrationContactHint(res.contact_hint || 'your mobile number');
        setRegistrationOtp('');
        setRegistrationConsent(false);
        setRegistrationResendCooldown(res.resend_cooldown_seconds || 60);
        setRegistrationOtpExpiresMinutes(res.expires_in_minutes || 10);
        setSuccess(`We sent an SMS verification code to ${res.contact_hint || 'your mobile number'}. Enter it to finish creating your account.`);
        setFormErrors({});
      } else if (res.success) {
        showLoginSuccess(res.user);
        navigateAfterAuth(res.user);
      } else if (res.mfaRequired) {
        const contactHint = String(res.contact_hint || 'your registered mobile number');
        setAdminMfaStep(true);
        setAdminMfaToken(res.mfa_token || '');
        setAdminMfaContactHint(contactHint);
        setAdminMfaOtp('');
        setAdminMfaProvider('google');
        setAdminMfaGoogleCredential(credential);
        setAdminMfaResendCooldown(res.resend_cooldown_seconds || 60);
        setAdminMfaOtpExpiresMinutes(res.expires_in_minutes || 10);
        setSuccess(`Admin SMS verification code sent to ${contactHint}.`);
        setFormErrors({});
      } else {
        if (res.errors?.phone_number) {
          setFormErrors({ phone: Array.isArray(res.errors.phone_number) ? res.errors.phone_number.join(' ') : res.errors.phone_number });
        }
        setError(res.error);
      }
    } catch (nativeError) {
      console.error('Native Google login failed:', nativeError);
      setError('Google sign-in was cancelled or could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const errors = adminMfaStep
      ? (adminMfaToken && adminMfaOtp.length === 6 ? {} : { otp: 'Enter the 6-digit verification code.' })
      : validateLoginForm();
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setLoading(true);
    const verification = adminMfaStep
      ? { mfa_token: adminMfaToken, mfa_code: adminMfaOtp }
      : {};
    const res = adminMfaStep && adminMfaProvider === 'google'
      ? await loginWithGoogle(adminMfaGoogleCredential, '', verification)
      : await login(form.username, form.password, verification);
    setLoading(false);
    if (res.mfaRequired) {
      const contactHint = String(res.contact_hint || '');
      if (res.mfa_method !== 'sms' || contactHint.includes('@')) {
        setAdminMfaStep(false);
        setAdminMfaToken('');
        setAdminMfaContactHint('');
        setAdminMfaOtp('');
        setSuccess('');
        setError('Admin verification must use SMS. Please sign in again to request a new code.');
        return;
      }
      setAdminMfaStep(true);
      setAdminMfaToken(res.mfa_token || '');
      setAdminMfaContactHint(contactHint || 'your registered mobile number');
      setAdminMfaOtp('');
      setAdminMfaResendCooldown(res.resend_cooldown_seconds || 60);
      setAdminMfaOtpExpiresMinutes(res.expires_in_minutes || 10);
      setSuccess(`Admin SMS verification code sent to ${contactHint || 'your registered mobile number'}.`);
      setFormErrors({});
    } else if (res.success) {
      showLoginSuccess(res.user);
      navigateAfterAuth(res.user);
    } else {
      setError(res.error);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (registerStep === 'otp') {
      if (registrationOtp.length !== 6) {
        setFormErrors({ otp: 'Enter the 6-digit verification code.' });
        return;
      }
      setLoading(true);
      try {
        const response = await client.post('/api/auth/register/verify/', {
          registration_token: registrationToken,
          otp: registrationOtp,
          privacy_consent: registrationConsent,
        });
        setSuccess(response.data?.message || 'Account created successfully! Please log in.');
        setIsRegister(false);
        setRegisterStep('details');
        setRegistrationToken('');
        setRegistrationOtp('');
        setRegistrationConsent(false);
        setRegistrationContactHint('');
        setRegistrationResendCooldown(0);
        setForm((f) => ({ ...f, password: '', passwordConfirm: '' }));
        setFormErrors({});
      } catch (err) {
        setError(getApiErrorMessage(err, 'Invalid or expired OTP. Registration was not completed.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const errors = validateRegisterForm();
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setLoading(true);
    const regData = {
      username: form.username, password: form.password, email: form.email,
      first_name: form.firstName, last_name: form.lastName,
      phone_number: form.phone, address: form.address,
      privacy_consent: registrationConsent,
    };
    const res = await register(regData);
    setLoading(false);
    if (res.success) {
      setRegistrationToken(res.registration_token || '');
      setRegistrationContactHint(res.contact_hint || 'your mobile number');
      setRegistrationOtp('');
      setRegistrationResendCooldown(res.resend_cooldown_seconds || 60);
      setRegistrationOtpExpiresMinutes(res.expires_in_minutes || 10);
      setRegistrationConsent(true);
      setRegisterStep('otp');
      setSuccess(`We sent an SMS verification code to ${res.contact_hint || 'your mobile number'}. Enter it to finish creating your account.`);
      setFormErrors({});
    } else {
      const apiErrors = res.errors || {};
      if (typeof apiErrors === 'object' && !Array.isArray(apiErrors)) {
        const fieldError = value => Array.isArray(value) ? value.join(' ') : String(value || '');
        setFormErrors(current => ({
          ...current,
          username: fieldError(apiErrors.username) || current.username,
          email: fieldError(apiErrors.email) || current.email,
          phone: fieldError(apiErrors.phone_number) || current.phone,
          password: fieldError(apiErrors.password) || current.password,
        }));
      }
      const errorMsg = typeof apiErrors === 'object'
        ? Object.entries(apiErrors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`).join(', ')
        : apiErrors?.detail || 'Registration failed.';
      setError(errorMsg);
    }
  };

  const resetForgotPasswordFlow = () => {
    setShowForgotPassword(false);
    setForgotStep('phone');
    setForgotPhone('');
    setForgotOtp('');
    setForgotResetToken('');
    setForgotPassword('');
    setForgotPasswordConfirm('');
    setShowForgotNewPassword(false);
    setForgotResult(null);
    setForgotErrors({});
    setForgotResendCooldown(0);
    setForgotOtpExpiresMinutes(10);
  };

  const useDifferentResetPhone = () => {
    setForgotStep('phone');
    setForgotOtp('');
    setForgotResetToken('');
    setForgotPassword('');
    setForgotPasswordConfirm('');
    setForgotResult(null);
    setForgotErrors({});
    setForgotResendCooldown(0);
    setForgotOtpExpiresMinutes(10);
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setForgotResult(null);
    const errors = validateForgotForm();
    setForgotErrors(errors);
    if (Object.keys(errors).length) return;
    setForgotLoading(true);

    try {
      if (forgotStep === 'phone') {
        const res = await client.post('/api/auth/forgot-password/', { phone_number: forgotPhone });
        setForgotResult({ detail: res.data?.detail || 'If this mobile number matches an account and a new code can be issued, check your SMS. For privacy, account status is not confirmed here.' });
        setForgotResendCooldown(res.data?.resend_cooldown_seconds || 60);
        setForgotOtpExpiresMinutes(res.data?.expires_in_minutes || 10);
        setForgotStep('otp');
        return;
      }

      if (forgotStep === 'otp') {
        const res = await client.post('/api/auth/forgot-password/verify/', {
          phone_number: forgotPhone,
          otp: forgotOtp,
        });
        setForgotResetToken(res.data?.reset_token || '');
        setForgotResult({ detail: res.data?.detail || 'OTP verified. You can now set a new password.' });
        setForgotStep('password');
        return;
      }

      const res = await client.post('/api/auth/forgot-password/confirm/', {
        phone_number: forgotPhone,
        reset_token: forgotResetToken,
        new_password: forgotPassword,
      });
      setSuccess(res.data?.detail || 'Password updated successfully. You can now sign in.');
      resetForgotPasswordFlow();
      setForm((f) => ({ ...f, password: '' }));
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Unable to complete password recovery. Please try again.');
      setForgotResult({ detail: msg, error: true });
    } finally {
      setForgotLoading(false);
    }
  };

  useEffect(() => {
    if (forgotResendCooldown <= 0) return undefined;
    const interval = window.setInterval(() => {
      setForgotResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [forgotResendCooldown]);

  useEffect(() => {
    if (registrationResendCooldown <= 0) return undefined;
    const interval = window.setInterval(() => {
      setRegistrationResendCooldown(current => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [registrationResendCooldown]);

  useEffect(() => {
    if (adminMfaResendCooldown <= 0) return undefined;
    const interval = window.setInterval(() => {
      setAdminMfaResendCooldown(current => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [adminMfaResendCooldown]);

  const handleRegistrationResend = async () => {
    if (loading || !registrationToken || registrationResendCooldown > 0) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await client.post('/api/auth/register/resend/', { registration_token: registrationToken });
      setRegistrationOtp('');
      setRegistrationContactHint(response.data?.contact_hint || registrationContactHint);
      setRegistrationOtpExpiresMinutes(response.data?.expires_in_minutes || 10);
      setRegistrationResendCooldown(response.data?.resend_cooldown_seconds || 60);
      setSuccess(`A new verification code was sent to ${response.data?.contact_hint || registrationContactHint}. It expires in ${response.data?.expires_in_minutes || registrationOtpExpiresMinutes} minutes.`);
    } catch (err) {
      const retryAfter = Number(err.response?.data?.retry_after_seconds);
      if (retryAfter > 0) setRegistrationResendCooldown(retryAfter);
      setError(getApiErrorMessage(err, 'Unable to resend the verification code. Please try again later.'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotResend = async () => {
    if (forgotLoading || forgotResendCooldown > 0) return;
    setForgotLoading(true);
    setForgotResult(null);
    try {
      const res = await client.post('/api/auth/forgot-password/', { phone_number: forgotPhone });
      setForgotOtp('');
      setForgotResetToken('');
      setForgotResult({ detail: res.data?.detail || 'If this mobile number matches an account and a new code can be issued, check your SMS. For privacy, account status is not confirmed here.' });
      setForgotResendCooldown(res.data?.resend_cooldown_seconds || 60);
      setForgotOtpExpiresMinutes(res.data?.expires_in_minutes || 10);
    } catch (err) {
      setForgotResult({ detail: getApiErrorMessage(err, 'Unable to resend the OTP right now. Please try again later.'), error: true });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleAdminMfaResend = async () => {
    if (loading || !adminMfaToken || adminMfaResendCooldown > 0) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await client.post('/api/auth/login/mfa/resend/', { mfa_token: adminMfaToken });
      setAdminMfaOtp('');
      setAdminMfaOtpExpiresMinutes(response.data?.expires_in_minutes || 10);
      setAdminMfaResendCooldown(response.data?.resend_cooldown_seconds || 60);
      setSuccess(`A new admin verification code was sent to ${adminMfaContactHint}. It expires in ${response.data?.expires_in_minutes || 10} minutes.`);
    } catch (err) {
      const retryAfter = Number(err.response?.data?.retry_after_seconds);
      if (retryAfter > 0) setAdminMfaResendCooldown(retryAfter);
      setError(getApiErrorMessage(err, 'Unable to resend the admin verification code. Please try again later.'));
    } finally {
      setLoading(false);
    }
  };

  const clearModeMessages = () => {
    setError('');
    setSuccess('');
    setFormErrors({});
    setForgotErrors({});
  };

  const resetRegistrationFlow = () => {
    setRegisterStep('details');
    setRegistrationToken('');
    setRegistrationContactHint('');
    setRegistrationOtp('');
    setRegistrationConsent(false);
    setRegistrationResendCooldown(0);
    setRegistrationOtpExpiresMinutes(10);
  };

  const resetAdminMfaFlow = () => {
    setAdminMfaStep(false);
    setAdminMfaToken('');
    setAdminMfaContactHint('');
    setAdminMfaOtp('');
    setAdminMfaProvider('password');
    setAdminMfaGoogleCredential('');
    setAdminMfaResendCooldown(0);
    setAdminMfaOtpExpiresMinutes(10);
  };

  const formTitle = isRegister ? 'Join CAV today' : showForgotPassword ? 'Reset password' : adminMfaStep ? 'Verify admin access' : 'Sign in to CAV';
  const formKicker = isRegister ? 'Create account' : showForgotPassword ? 'Account recovery' : 'Member access';
  const formDescription = isRegister
    ? 'Create an account to book studio sessions and stay connected with CAV.'
    : showForgotPassword
      ? 'Use your registered mobile number to receive an SMS OTP, verify it, and choose a new password.'
    : adminMfaStep
      ? `Enter the 6-digit SMS code sent to ${adminMfaContactHint}.`
      : 'Access your dashboard, bookings, and account tools.';
  const forgotStepInfo = {
    phone: {
      title: 'Request OTP',
      description: "Enter the mobile number registered to your CAV account. We'll send a one-time code if the account exists.",
      button: 'Send OTP',
    },
    otp: {
      title: 'Verify OTP',
      description: 'Enter the 6-digit code from SMS. Codes expire quickly and can only be used once.',
      button: 'Verify OTP',
    },
    password: {
      title: 'Set New Password',
      description: 'Choose a strong password to finish securing your account.',
      button: 'Update Password',
    },
  };
  const forgotSteps = [
    { key: 'phone', label: 'Mobile' },
    { key: 'otp', label: 'OTP' },
    { key: 'password', label: 'Password' },
  ];
  const activeForgotStepIndex = forgotSteps.findIndex((step) => step.key === forgotStep);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-8 sm:px-6 lg:px-8 page-transition">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.18),transparent_34%),linear-gradient(135deg,#fdfbf7_0%,#f5ece1_45%,#2e1a11_45%,#1c0f0a_100%)]" />
      <div className="absolute right-8 top-8 hidden h-40 w-40 rounded-full border border-gold/20 lg:block" />
      <div className="absolute bottom-10 left-10 hidden h-28 w-28 rounded-full border border-espresso/10 lg:block" />

      <button
        onClick={() => navigate('/')}
        className="absolute left-5 top-5 z-20 flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-espresso/70 shadow-[0_12px_28px_rgba(46,26,17,0.08)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:text-espresso active:translate-y-0 active:scale-[0.98]"
      >
        <ArrowLeft className="h-4 w-4" /> Return Home
      </button>

      <div className="relative z-10 grid w-full max-w-6xl overflow-hidden rounded-[28px] bg-espresso-dark shadow-[0_36px_90px_rgba(46,26,17,0.28)] lg:min-h-[720px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative flex min-h-[360px] flex-col justify-between overflow-hidden bg-espresso p-8 text-cream sm:p-10 lg:p-12">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(212,175,55,0.22),transparent_32%),radial-gradient(circle_at_82%_22%,rgba(255,255,255,0.12),transparent_24%)]" />
          <div className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full border border-gold/20" />
          <div className="absolute bottom-12 right-12 h-28 w-28 rounded-full bg-gold/10 blur-2xl" />

          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-gold text-espresso shadow-[0_18px_45px_rgba(212,175,55,0.24)]">
              <Camera className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-extrabold leading-none text-white">CAV</p>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold/85">Studio &amp; Cafe</p>
            </div>
          </div>

          <div className="relative max-w-xl space-y-7 py-12 lg:py-0">
            <div className="inline-flex rounded-full border border-gold/25 bg-white/[0.07] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-gold">
              Capture. Sip. Celebrate.
            </div>
            <div className="space-y-5">
              <h1 className="text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Welcome to your CAV experience.
              </h1>
              <p className="max-w-lg text-base leading-relaxed text-cream/76 sm:text-lg">
                CAV brings photo studio bookings, cafe orders, and customer updates into one polished space. Sign in to manage your sessions, check your account, and keep every visit organized.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
                <Camera className="mb-3 h-5 w-5 text-gold" />
                <p className="text-sm font-bold text-white">Studio bookings</p>
                <p className="mt-1 text-xs leading-relaxed text-cream/60">Reserve rooms and manage packages for portraits, birthdays, and events.</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
                <Coffee className="mb-3 h-5 w-5 text-gold" />
                <p className="text-sm font-bold text-white">Cafe moments</p>
                <p className="mt-1 text-xs leading-relaxed text-cream/60">Pair every session with fresh drinks, pastries, and a relaxed cafe stop.</p>
              </div>
            </div>
          </div>

          <div className="relative flex flex-wrap gap-3 text-xs font-semibold text-cream/70">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2">
              <CalendarCheck className="h-3.5 w-3.5 text-gold" /> Easy booking
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2">
              <Camera className="h-3.5 w-3.5 text-gold" /> Professional studio
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2">
              <Coffee className="h-3.5 w-3.5 text-gold" /> Cafe service
            </span>
          </div>
        </section>

        <section className="flex items-center bg-cream px-5 py-8 sm:px-8 lg:px-10">
          <div className="mx-auto w-full max-w-md space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">{formKicker}</p>
              <h2 className="text-3xl font-black tracking-tight text-espresso sm:text-4xl">{formTitle}</h2>
              <p className="text-sm leading-relaxed text-espresso/62">{formDescription}</p>
            </div>

            <div className="space-y-6 rounded-[24px] border border-espresso/[0.06] bg-white p-5 shadow-[0_24px_65px_rgba(46,26,17,0.10)] sm:p-6">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-700" role="alert">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-700" role="status">
                  {success}
                </div>
              )}

              {!showForgotPassword && (
                <div className="space-y-3">
                  {googleClientId ? (
                    isNativeApp ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={handleNativeGoogleLogin}
                          disabled={!googleReady || loading}
                          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-espresso/15 bg-white px-4 text-sm font-bold text-espresso shadow-sm transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4285F4] text-xs font-black text-white">G</span>
                          {googleReady ? `Continue with Google${isRegister ? ' to sign up' : ''}` : 'Preparing Google sign-in...'}
                        </button>
                        {googleInitError && <p className="text-center text-[11px] font-semibold text-red-600">{googleInitError}</p>}
                      </div>
                    ) : (
                      <div ref={googleButtonRef} className="flex min-h-[44px] justify-center" />
                    )
                  ) : (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-700">
                      Add REACT_APP_GOOGLE_CLIENT_ID to enable Google {isRegister ? 'registration' : 'login'}.
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-espresso/10" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-espresso/35">or</span>
                    <div className="h-px flex-1 bg-espresso/10" />
                  </div>
                </div>
              )}

              {showForgotPassword ? (
                <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
                  <div className="space-y-4 pb-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/10 text-gold">
                        {forgotStep === 'password' ? <CheckCircle2 className="h-6 w-6" /> : <RefreshCw className="h-6 w-6" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-espresso">{forgotStepInfo[forgotStep].title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-espresso/50">{forgotStepInfo[forgotStep].description}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {forgotSteps.map((step, index) => {
                        const isActive = step.key === forgotStep;
                        const isComplete = index < activeForgotStepIndex;
                        return (
                          <div
                            key={step.key}
                            className={`rounded-full px-2.5 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                              isActive || isComplete
                                ? 'bg-gold text-espresso'
                                : 'bg-espresso/[0.06] text-espresso/42'
                            }`}
                          >
                            {step.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {forgotResult && (
                    <div className={`space-y-2 rounded-xl p-3.5 text-xs ${forgotResult.error ? 'border border-red-500/20 bg-red-500/10 text-red-700' : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700'}`}>
                      <p>{forgotResult.detail}</p>
                    </div>
                  )}

                  {forgotStep === 'phone' && (
                    <Input
                      label="Registered Mobile Number"
                      icon={Phone}
                      type="tel"
                      inputMode="tel"
                      required
                      value={forgotPhone}
                      onChange={(e) => {
                        setForgotPhone(e.target.value);
                        setForgotErrors(current => ({ ...current, phone: '' }));
                      }}
                      placeholder="0917 123 4567"
                      error={forgotErrors.phone}
                    />
                  )}

                  {forgotStep === 'otp' && (
                    <div className="space-y-3">
                      <Input
                        label="One-Time OTP"
                        icon={Key}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        required
                        value={forgotOtp}
                        onChange={(e) => {
                          setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                          setForgotErrors(current => ({ ...current, otp: '' }));
                        }}
                        placeholder="000000"
                        className="text-center font-mono text-lg tracking-[0.24em]"
                        error={forgotErrors.otp}
                      />
                      <p className="text-xs text-espresso/50">A valid code expires in {forgotOtpExpiresMinutes} minutes.</p>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={handleForgotResend}
                          disabled={forgotLoading || forgotResendCooldown > 0}
                          className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold disabled:cursor-not-allowed disabled:text-espresso/35"
                        >
                          {forgotResendCooldown > 0 ? `Resend code in ${forgotResendCooldown}s` : 'Resend code'}
                        </button>
                        <button
                          type="button"
                          onClick={useDifferentResetPhone}
                          className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                        >
                          Use a different mobile number
                        </button>
                      </div>
                    </div>
                  )}

                  {forgotStep === 'password' && (
                    <div className="space-y-4">
                      <Input
                        label="New Password"
                        icon={Key}
                        type={showForgotNewPassword ? 'text' : 'password'}
                        required
                        value={forgotPassword}
                        onChange={(e) => {
                          setForgotPassword(e.target.value);
                          setForgotErrors(current => ({ ...current, password: '', passwordConfirm: '' }));
                        }}
                        placeholder="Enter a new password"
                        error={forgotErrors.password}
                        suffix={
                          <button
                            type="button"
                            onClick={() => setShowForgotNewPassword(!showForgotNewPassword)}
                            className="p-1 text-espresso/35 transition-colors hover:text-espresso/60"
                            tabIndex={-1}
                            aria-label={showForgotNewPassword ? 'Hide password' : 'Show password'}
                          >
                            {showForgotNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      />
                      <Input
                        label="Confirm Password"
                        icon={Key}
                        type={showForgotNewPassword ? 'text' : 'password'}
                        required
                        value={forgotPasswordConfirm}
                        onChange={(e) => {
                          setForgotPasswordConfirm(e.target.value);
                          setForgotErrors(current => ({ ...current, passwordConfirm: '' }));
                        }}
                        placeholder="Re-enter new password"
                        error={forgotErrors.passwordConfirm}
                      />
                      <PasswordStrength password={forgotPassword} />
                      <button
                        type="button"
                        onClick={useDifferentResetPhone}
                        className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                      >
                        Use a different mobile number
                      </button>
                    </div>
                  )}

                  <Button type="submit" variant="gold" size="lg" loading={forgotLoading} disabled={forgotLoading || !isForgotValid} className="w-full">
                    {forgotStepInfo[forgotStep].button}
                  </Button>

                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={resetForgotPasswordFlow}
                      className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                    >
                      Return to Sign In
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={isRegister ? handleRegisterSubmit : handleLoginSubmit} className="space-y-4" noValidate>
                  {isRegister && registerStep === 'otp' ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-2xl border border-gold/20 bg-gold/5 p-4">
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-gold-dark" />
                        <div>
                          <p className="text-sm font-bold text-espresso">Verify your contact</p>
                          <p className="mt-1 text-xs leading-relaxed text-espresso/55">Enter the 6-digit SMS code sent to {registrationContactHint}.</p>
                        </div>
                      </div>
                      <Input
                        label="One-Time OTP"
                        icon={Key}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        required
                        value={registrationOtp}
                        onChange={(e) => {
                          setRegistrationOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                          setFormErrors(current => ({ ...current, otp: '' }));
                        }}
                        placeholder="000000"
                        className="text-center font-mono text-lg tracking-[0.24em]"
                        error={formErrors.otp}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <span className="text-espresso/50">This code expires in {registrationOtpExpiresMinutes} minutes.</span>
                        <button
                          type="button"
                          onClick={handleRegistrationResend}
                          disabled={loading || registrationResendCooldown > 0 || !registrationToken}
                          className="font-semibold text-gold-dark transition-colors hover:text-gold disabled:cursor-not-allowed disabled:text-espresso/35"
                        >
                          {registrationResendCooldown > 0 ? `Resend code in ${registrationResendCooldown}s` : 'Resend code'}
                        </button>
                      </div>
                      <label className="flex items-start gap-3 text-xs leading-5 text-espresso/72">
                        <input
                          type="checkbox"
                          checked={registrationConsent}
                          onChange={(e) => setRegistrationConsent(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-espresso/30 text-gold focus:ring-gold"
                        />
                        <span>I agree to the <Link to="/privacy-policy" className="font-bold text-gold-dark underline">Privacy Notice</Link> and service data processing.</span>
                      </label>
                    </div>
                  ) : adminMfaStep ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-2xl border border-gold/20 bg-gold/5 p-4">
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-gold-dark" />
                        <div>
                          <p className="text-sm font-bold text-espresso">Admin verification required</p>
                          <p className="mt-1 text-xs leading-relaxed text-espresso/55">This extra step protects privileged access.</p>
                        </div>
                      </div>
                      <Input
                        label="SMS one-time code"
                        icon={Key}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        required
                        value={adminMfaOtp}
                        onChange={(e) => {
                          setAdminMfaOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                          setFormErrors(current => ({ ...current, otp: '' }));
                        }}
                        placeholder="000000"
                        className="text-center font-mono text-lg tracking-[0.24em]"
                        error={formErrors.otp}
                      />
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-espresso/50">This code expires in {adminMfaOtpExpiresMinutes} minutes.</span>
                        <button
                          type="button"
                          onClick={handleAdminMfaResend}
                          disabled={loading || adminMfaResendCooldown > 0 || !adminMfaToken}
                          className="font-semibold text-gold-dark transition-colors hover:text-gold disabled:cursor-not-allowed disabled:text-espresso/35"
                        >
                          {adminMfaResendCooldown > 0 ? `Resend code in ${adminMfaResendCooldown}s` : 'Resend code'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Input
                        label="Username"
                        icon={User}
                        type="text"
                        required
                        value={form.username}
                        onChange={update('username')}
                        placeholder="Enter username"
                        error={formErrors.username}
                      />

                      {isRegister && (
                        <>
                          <Input
                            label="Email"
                            icon={Mail}
                            type="email"
                            required
                            value={form.email}
                            onChange={update('email')}
                            placeholder="name@example.com"
                            error={formErrors.email}
                          />
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Input
                              label="First Name"
                              value={form.firstName}
                              onChange={update('firstName')}
                              placeholder="First"
                            />
                            <Input
                              label="Last Name"
                              value={form.lastName}
                              onChange={update('lastName')}
                              placeholder="Last"
                            />
                          </div>
                          <Input
                            label="Mobile number"
                            type="tel"
                            value={form.phone}
                            onChange={update('phone')}
                            placeholder="+63 917 123 4567"
                            error={formErrors.phone}
                          />
                          <Textarea
                            label="Address"
                            value={form.address}
                            onChange={update('address')}
                            placeholder="Enter your address"
                            rows={2}
                          />
                        </>
                      )}

                      <Input
                        label="Password"
                        icon={Key}
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={form.password}
                        onChange={update('password')}
                        placeholder="Enter password"
                        error={formErrors.password}
                        suffix={
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="p-1 text-espresso/35 transition-colors hover:text-espresso/60"
                            tabIndex={-1}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      />

                      {isRegister && (
                        <>
                          <Input
                            label="Confirm Password"
                            icon={Key}
                            type={showPassword ? 'text' : 'password'}
                            required
                            value={form.passwordConfirm}
                            onChange={update('passwordConfirm')}
                            placeholder="Re-enter password"
                            error={formErrors.passwordConfirm}
                          />
                          <PasswordStrength password={form.password} />
                          <label className="flex items-start gap-3 text-xs leading-5 text-espresso/72">
                            <input
                              type="checkbox"
                              checked={registrationConsent}
                              onChange={(e) => {
                                setRegistrationConsent(e.target.checked);
                                setFormErrors(current => ({ ...current, privacyConsent: '' }));
                              }}
                              className="mt-1 h-4 w-4 rounded border-espresso/30 text-gold focus:ring-gold"
                            />
                            <span>I agree to the <Link to="/privacy-policy" className="font-bold text-gold-dark underline">Privacy Notice</Link> and service data processing.</span>
                          </label>
                        </>
                      )}

                      {!isRegister && (
                        <div className="-mt-2 text-right">
                          <button
                            type="button"
                            onClick={() => { setShowForgotPassword(true); clearModeMessages(); }}
                            className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  <Button
                    type="submit"
                    variant="gold"
                    size="lg"
                    loading={loading}
                    disabled={loading || (isRegister ? !isRegisterValid : !isLoginValid)}
                    className="mt-1 w-full"
                  >
                    {isRegister
                      ? (registerStep === 'otp' ? 'Verify & Create Account' : 'Send Verification Code')
                      : adminMfaStep
                        ? 'Verify Admin Access'
                        : 'Enter My Dashboard'}
                  </Button>
                </form>
              )}

              {!showForgotPassword && !adminMfaStep && (
                <div className="space-y-3 pt-1 text-center">
                  <button
                    onClick={() => { resetRegistrationFlow(); resetAdminMfaFlow(); setIsRegister(!isRegister); clearModeMessages(); }}
                    className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                  >
                    {isRegister ? 'Already booked with CAV? Sign In' : 'New to CAV? Create an account'}
                  </button>
                  <p className="text-[11px] leading-5 text-espresso/45">
                    By continuing, you agree to CAV's transparent data practices.{' '}
                    <Link to="/privacy-policy" className="font-bold text-gold-dark hover:text-gold">
                      Read the Security & Privacy Policy
                    </Link>
                    .
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
