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
  getPhoneError,
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
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotPasswordConfirm, setForgotPasswordConfirm] = useState('');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState(null);
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
      phone: getPhoneError(values.phone),
      password: getPasswordError(values.password),
      passwordConfirm: getConfirmPasswordError(values.password, values.passwordConfirm),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const validateForgotForm = () => {
    if (forgotStep === 'email') {
      const email = getEmailError(forgotEmail, { required: true, label: 'Registered email' });
      return email ? { email } : {};
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

  const isLoginValid = !isBlank(form.username) && !isBlank(form.password);
  const isRegisterValid = !Object.keys(validateRegisterForm()).length;
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
    const res = await loginWithGoogle(credential);
    setLoading(false);
    if (res.success) {
      showLoginSuccess(res.user);
      navigateAfterAuth(res.user);
    } else {
      setError(res.error);
    }
  }, [loginWithGoogle, navigateAfterAuth]);

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
      const res = await loginWithGoogle(credential);
      if (res.success) {
        showLoginSuccess(res.user);
        navigateAfterAuth(res.user);
      } else {
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
    const errors = validateLoginForm();
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setLoading(true);
    const res = await login(form.username, form.password);
    setLoading(false);
    if (res.success) {
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
    const errors = validateRegisterForm();
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setLoading(true);
    const regData = {
      username: form.username, password: form.password, email: form.email,
      first_name: form.firstName, last_name: form.lastName,
      phone_number: form.phone, address: form.address,
    };
    const res = await register(regData);
    setLoading(false);
    if (res.success) {
      setSuccess('Account created successfully! Please log in.');
      setIsRegister(false);
      setForm((f) => ({ ...f, password: '', passwordConfirm: '' }));
      setFormErrors({});
    } else {
      const apiErrors = res.errors || {};
      if (typeof apiErrors === 'object' && !Array.isArray(apiErrors)) {
        setFormErrors(current => ({
          ...current,
          username: apiErrors.username?.join?.(' ') || current.username,
          email: apiErrors.email?.join?.(' ') || current.email,
          password: apiErrors.password?.join?.(' ') || current.password,
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
    setForgotStep('email');
    setForgotEmail('');
    setForgotOtp('');
    setForgotResetToken('');
    setForgotPassword('');
    setForgotPasswordConfirm('');
    setShowForgotNewPassword(false);
    setForgotResult(null);
    setForgotErrors({});
  };

  const useDifferentResetEmail = () => {
    setForgotStep('email');
    setForgotOtp('');
    setForgotResetToken('');
    setForgotPassword('');
    setForgotPasswordConfirm('');
    setForgotResult(null);
    setForgotErrors({});
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
      if (forgotStep === 'email') {
        const res = await client.post('/api/auth/forgot-password/', { email: forgotEmail });
        setForgotResult({ detail: res.data?.detail || 'If that email is registered, a one-time password has been sent.' });
        setForgotStep('otp');
        return;
      }

      if (forgotStep === 'otp') {
        const res = await client.post('/api/auth/forgot-password/verify/', {
          email: forgotEmail,
          otp: forgotOtp,
        });
        setForgotResetToken(res.data?.reset_token || '');
        setForgotResult({ detail: res.data?.detail || 'OTP verified. You can now set a new password.' });
        setForgotStep('password');
        return;
      }

      const res = await client.post('/api/auth/forgot-password/confirm/', {
        email: forgotEmail,
        reset_token: forgotResetToken,
        new_password: forgotPassword,
      });
      setSuccess(res.data?.detail || 'Password updated successfully. You can now sign in.');
      resetForgotPasswordFlow();
      setForm((f) => ({ ...f, email: forgotEmail, password: '' }));
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Unable to complete password recovery. Please try again.');
      setForgotResult({ detail: msg, error: true });
    } finally {
      setForgotLoading(false);
    }
  };

  const quickLogin = async (user, pass) => {
    setError('');
    setLoading(true);
    const res = await login(user, pass);
    setLoading(false);
    if (res.success) {
      showLoginSuccess(res.user);
      navigateAfterAuth(res.user);
    } else {
      setError(res.error);
    }
  };

  const clearModeMessages = () => {
    setError('');
    setSuccess('');
    setFormErrors({});
    setForgotErrors({});
  };

  const formTitle = isRegister ? 'Join CAV today' : showForgotPassword ? 'Reset password' : 'Sign in to CAV';
  const formKicker = isRegister ? 'Create account' : showForgotPassword ? 'Account recovery' : 'Member access';
  const formDescription = isRegister
    ? 'Create an account to book studio sessions and stay connected with CAV.'
    : showForgotPassword
      ? 'Use your registered email to receive an OTP, verify it, and choose a new password.'
      : 'Access your dashboard, bookings, and account tools.';
  const forgotStepInfo = {
    email: {
      title: 'Request OTP',
      description: "Enter the email registered to your CAV account. We'll send a one-time code if the account exists.",
      button: 'Send OTP',
    },
    otp: {
      title: 'Verify OTP',
      description: 'Enter the 6-digit code from your email. Codes expire quickly and can only be used once.',
      button: 'Verify OTP',
    },
    password: {
      title: 'Set New Password',
      description: 'Choose a strong password to finish securing your account.',
      button: 'Update Password',
    },
  };
  const forgotSteps = [
    { key: 'email', label: 'Email' },
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

            {!isRegister && !showForgotPassword && (
              <div className="space-y-3 rounded-[22px] border border-espresso/[0.06] bg-white p-4 shadow-[0_18px_45px_rgba(46,26,17,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/45">Quick Login Accounts</p>
                  <span className="rounded-full bg-gold/10 px-2.5 py-1 text-[10px] font-black text-gold-dark">Click to sign in</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: 'Customer',
                      user: 'customer',
                      pass: 'Customer123!',
                      icon: User,
                      helper: 'Bookings and rewards',
                      accent: 'text-emerald-700 bg-emerald-50 border-emerald-200 group-hover:bg-emerald-100',
                      ring: 'group-hover:border-emerald-300 group-hover:shadow-[0_18px_36px_rgba(5,150,105,0.12)]',
                    },
                    {
                      label: 'Staff',
                      user: 'staff',
                      pass: 'Staff123!',
                      icon: Coffee,
                      helper: 'POS and inventory',
                      accent: 'text-gold-dark bg-gold/10 border-gold/30 group-hover:bg-gold/20',
                      ring: 'group-hover:border-gold/45 group-hover:shadow-[0_18px_36px_rgba(212,175,55,0.16)]',
                    },
                    {
                      label: 'Admin',
                      user: 'admin',
                      pass: 'Admin123!',
                      icon: ShieldAlert,
                      helper: 'System controls',
                      accent: 'text-red-700 bg-red-50 border-red-200 group-hover:bg-red-100',
                      ring: 'group-hover:border-red-200 group-hover:shadow-[0_18px_36px_rgba(220,38,38,0.12)]',
                    },
                  ].map(({ label, user, pass, icon: Icon, helper, accent, ring }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => quickLogin(user, pass)}
                      disabled={loading}
                      className={`group flex min-h-[148px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-espresso/[0.07] bg-cream px-3 py-4 text-center transition-all duration-300 hover:-translate-y-1 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${ring}`}
                    >
                      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-[0_10px_22px_rgba(46,26,17,0.07)] transition-colors ${accent}`}>
                        <Icon className="h-6 w-6" />
                      </span>
                      <span className="flex min-w-0 flex-col items-center gap-1">
                        <span className="block text-sm font-black leading-tight text-espresso">{label}</span>
                        <span className="block max-w-[8.5rem] text-[11px] font-semibold leading-snug text-espresso/52">{helper}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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

                  {forgotStep === 'email' && (
                    <Input
                      label="Registered Email"
                      icon={Mail}
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => {
                        setForgotEmail(e.target.value);
                        setForgotErrors(current => ({ ...current, email: '' }));
                      }}
                      placeholder="name@example.com"
                      error={forgotErrors.email}
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
                      <button
                        type="button"
                        onClick={useDifferentResetEmail}
                        className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                      >
                        Use a different email
                      </button>
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
                        onClick={useDifferentResetEmail}
                        className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                      >
                        Use a different email
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
                        label="Phone"
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

                  <Button
                    type="submit"
                    variant="gold"
                    size="lg"
                    loading={loading}
                    disabled={loading || (isRegister ? !isRegisterValid : !isLoginValid)}
                    className="mt-1 w-full"
                  >
                    {isRegister ? 'Create My CAV Account' : 'Enter My Dashboard'}
                  </Button>
                </form>
              )}

              {!showForgotPassword && (
                <div className="space-y-3 pt-1 text-center">
                  <button
                    onClick={() => { setIsRegister(!isRegister); clearModeMessages(); }}
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
