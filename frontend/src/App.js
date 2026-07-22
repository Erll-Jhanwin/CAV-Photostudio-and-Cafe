import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StyledAlertProvider } from './components/ui/StyledAlert';
import { isChunkLoadError, lazyWithRetry, reloadWithFreshAssets, resetChunkReloadAttempt } from './utils/lazyWithRetry';
import { brandAssets } from './utils/cavAssets';
import AdminDashboard from './pages/AdminDashboard';

const LandingPage = lazy(() => lazyWithRetry(() => import('./pages/LandingPage')));
const LoginPage = lazy(() => lazyWithRetry(() => import('./pages/LoginPage')));
const PrivacyPolicyPage = lazy(() => lazyWithRetry(() => import('./pages/PrivacyPolicyPage')));
const CustomerDashboard = lazy(() => lazyWithRetry(() => import('./pages/CustomerDashboard')));
const StaffDashboard = lazy(() => lazyWithRetry(() => import('./pages/StaffDashboard')));
const SPLASH_SEEN_KEY = 'cav:splash-seen';

function AppLoader() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-espresso/10 border-t-gold rounded-full animate-spin" />
        <p className="text-xs text-espresso/40 font-medium">Loading...</p>
      </div>
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="min-h-screen overflow-hidden bg-espresso flex items-center justify-center px-6 text-cream">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(212,175,55,0.16),transparent_38%,rgba(255,255,255,0.05))]" />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-[28px] bg-gold/20 blur-2xl animate-pulse" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-[28px] border border-gold/25 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:h-28 sm:w-28">
            <img src={brandAssets.logo} alt="CAV logo" className="h-16 w-16 rounded-2xl object-cover sm:h-20 sm:w-20" />
          </div>
        </div>

        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-gold">Photo Studio & Cafe</p>
        <h1 className="mt-2 font-sans text-4xl font-black tracking-normal text-white sm:text-5xl">CAV</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-cream/68">
          Preparing your studio, cafe, and booking space.
        </p>

        <div className="mt-8 flex items-center gap-2" aria-label="Loading">
          {[0, 1, 2].map((item) => (
            <span
              key={item}
              className="h-2.5 w-2.5 rounded-full bg-gold animate-bounce"
              style={{ animationDelay: `${item * 0.16}s` }}
            />
          ))}
        </div>
        <div className="mt-5 h-1.5 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-full origin-left rounded-full bg-gold animate-[splashProgress_2.4s_ease-in-out_forwards]" />
        </div>
      </div>
    </div>
  );
}

function StartupSplashGate({ children }) {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return sessionStorage.getItem(SPLASH_SEEN_KEY) !== 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!showSplash) return undefined;
    void import('./pages/LandingPage');
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, 'true');
      } catch {
        /* ignore private browsing storage failures */
      }
      setShowSplash(false);
      navigate('/', { replace: true });
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [navigate, showSplash]);

  return showSplash ? <SplashScreen /> : children;
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
    if (user.role === 'STAFF') return <Navigate to="/staff" replace />;
    return <Navigate to="/customer" replace />;
  }

  return children;
}

class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  handleReload = () => {
    resetChunkReloadAttempt();
    reloadWithFreshAssets();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const needsUpdate = isChunkLoadError(this.state.error);

    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-espresso/10 bg-white p-6 text-center shadow-[0_24px_65px_rgba(46,26,17,0.10)]">
          <h1 className="text-xl font-black text-espresso">{needsUpdate ? 'Page update required' : 'Unable to load this page'}</h1>
          <p className="mt-2 text-sm leading-relaxed text-espresso/60">
            {needsUpdate
              ? 'The app loaded an old page file. Refresh to load the latest version.'
              : 'Please refresh the app. If the problem continues, contact an administrator.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-espresso shadow-[0_14px_34px_rgba(212,175,55,0.22)] transition-all hover:-translate-y-0.5 hover:bg-gold-light"
          >
            Refresh App
          </button>
        </div>
      </div>
    );
  }
}

function App() {
  return (
    <AuthProvider>
      <StyledAlertProvider>
        <BrowserRouter>
          <ChunkErrorBoundary>
            <StartupSplashGate>
              <Suspense fallback={<AppLoader />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                  <Route
                    path="/customer"
                    element={
                      <ProtectedRoute allowedRoles={['CUSTOMER']}>
                        <CustomerDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/staff"
                    element={
                      <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']}>
                        <StaffDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute allowedRoles={['ADMIN']}>
                        <AdminDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </StartupSplashGate>
          </ChunkErrorBoundary>
        </BrowserRouter>
      </StyledAlertProvider>
    </AuthProvider>
  );
}

export default App;
