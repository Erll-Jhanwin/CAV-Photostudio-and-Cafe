import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Coffee,
  CalendarCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import client from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithGoogle, register } = useAuth();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [isRegister, setIsRegister] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

  const [form, setForm] = useState({
    username: '', password: '', email: '',
    firstName: '', lastName: '', phone: '', address: '',
  });

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const navigateAfterAuth = useCallback((authUser) => {
    if (redirect === 'book') { navigate('/customer'); return; }
    if (authUser.role === 'ADMIN') navigate('/admin');
    else if (authUser.role === 'STAFF') navigate('/staff');
    else navigate('/customer');
  }, [navigate, redirect]);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return undefined;

    let cancelled = false;

    const handleGoogleCredential = async (response) => {
      if (!response?.credential) return;
      setError('');
      setSuccess('');
      setLoading(true);
      const res = await loginWithGoogle(response.credential);
      setLoading(false);
      if (res.success) {
        navigateAfterAuth(res.user);
      } else {
        setError(res.error);
      }
    };

    const renderGoogleButton = () => {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
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
  }, [googleClientId, isRegister, loginWithGoogle, navigateAfterAuth]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await login(form.username, form.password);
    setLoading(false);
    if (res.success) {
      navigateAfterAuth(res.user);
    } else {
      setError(res.error);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
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
      setForm((f) => ({ ...f, password: '' }));
    } else {
      const errorMsg = typeof res.errors === 'object'
        ? Object.entries(res.errors).map(([k, v]) => `${k}: ${v}`).join(', ')
        : res.errors?.detail || 'Registration failed.';
      setError(errorMsg);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setForgotResult(null);
    setForgotLoading(true);
    try {
      const res = await client.post('/api/auth/forgot-password/', { username: forgotUsername });
      setForgotResult(res.data);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Something went wrong. Please try again.';
      setForgotResult({ detail: msg });
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
      navigateAfterAuth(res.user);
    } else {
      setError(res.error);
    }
  };

  const clearModeMessages = () => {
    setError('');
    setSuccess('');
  };

  const formTitle = isRegister ? 'Join CAV today' : showForgotPassword ? 'Reset password' : 'Sign in to CAV';
  const formKicker = isRegister ? 'Create account' : showForgotPassword ? 'Account recovery' : 'Member access';
  const formDescription = isRegister
    ? 'Create an account to book studio sessions and stay connected with CAV.'
    : showForgotPassword
      ? "Enter your username and we'll generate a temporary password for your account."
      : 'Access your dashboard, bookings, and account tools.';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-8 sm:px-6 lg:px-8 page-transition">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.18),transparent_34%),linear-gradient(135deg,#fdfbf7_0%,#f5ece1_45%,#2e1a11_45%,#1c0f0a_100%)]" />
      <div className="absolute right-8 top-8 hidden h-40 w-40 rounded-full border border-gold/20 lg:block" />
      <div className="absolute bottom-10 left-10 hidden h-28 w-28 rounded-full border border-espresso/10 lg:block" />

      <button
        onClick={() => navigate('/')}
        className="absolute left-5 top-5 z-20 flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-espresso/70 shadow-[0_12px_28px_rgba(46,26,17,0.08)] backdrop-blur transition-colors hover:text-espresso"
      >
        <ArrowLeft className="h-4 w-4" /> Back
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
                <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/45">Quick Login</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Customer', user: 'customer', pass: 'Customer123!' },
                    { label: 'Staff', user: 'staff', pass: 'Staff123!' },
                    { label: 'Admin', user: 'admin', pass: 'Admin123!' },
                  ].map(({ label, user, pass }) => (
                    <button
                      key={label}
                      onClick={() => quickLogin(user, pass)}
                      disabled={loading}
                      className="rounded-[16px] border border-espresso/[0.06] bg-cream px-2 py-3 text-xs font-bold text-espresso/70 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cream-dark hover:text-espresso disabled:opacity-50"
                    >
                      {label}
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
                    <div ref={googleButtonRef} className="flex min-h-[44px] justify-center" />
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
                  <div className="space-y-2 pb-2 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold">
                      <RefreshCw className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-espresso">Reset your password</p>
                    <p className="text-xs text-espresso/50">Enter your username and we'll generate a temporary password.</p>
                  </div>

                  {forgotResult && (
                    <div className={`space-y-2 rounded-xl p-3.5 text-xs ${forgotResult.temp_password ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border border-red-500/20 bg-red-500/10 text-red-700'}`}>
                      <p>{forgotResult.detail}</p>
                      {forgotResult.temp_password && (
                        <div className="rounded-lg bg-espresso/5 p-3 text-center">
                          <p className="mb-1 text-[10px] text-espresso/50">Temporary Password</p>
                          <p className="font-mono text-sm font-bold tracking-wider text-gold">{forgotResult.temp_password}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <Input
                    label="Username"
                    icon={User}
                    type="text"
                    required
                    value={forgotUsername}
                    onChange={(e) => setForgotUsername(e.target.value)}
                    placeholder="Enter your username"
                  />

                  <Button type="submit" variant="gold" size="lg" loading={forgotLoading} className="w-full">
                    Generate Temporary Password
                  </Button>

                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => { setShowForgotPassword(false); setForgotResult(null); setForgotUsername(''); }}
                      className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                    >
                      Back to Sign In
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

                  <Button type="submit" variant="gold" size="lg" loading={loading} className="mt-1 w-full">
                    {isRegister ? 'Create Account' : 'Sign In'}
                  </Button>
                </form>
              )}

              {!showForgotPassword && (
                <div className="pt-1 text-center">
                  <button
                    onClick={() => { setIsRegister(!isRegister); clearModeMessages(); }}
                    className="text-xs font-semibold text-gold-dark transition-colors hover:text-gold"
                  >
                    {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Register"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
