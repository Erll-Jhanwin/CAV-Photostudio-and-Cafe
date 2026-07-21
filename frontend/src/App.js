import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StyledAlertProvider } from './components/ui/StyledAlert';
import { lazyWithRetry, resetChunkReloadAttempt } from './utils/lazyWithRetry';

const LandingPage = lazy(() => lazyWithRetry(() => import('./pages/LandingPage')));
const LoginPage = lazy(() => lazyWithRetry(() => import('./pages/LoginPage')));
const PrivacyPolicyPage = lazy(() => lazyWithRetry(() => import('./pages/PrivacyPolicyPage')));
const CustomerDashboard = lazy(() => lazyWithRetry(() => import('./pages/CustomerDashboard')));
const StaffDashboard = lazy(() => lazyWithRetry(() => import('./pages/StaffDashboard')));
const AdminDashboard = lazy(() => lazyWithRetry(() => import('./pages/AdminDashboard')));

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
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  handleReload = () => {
    resetChunkReloadAttempt();
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-espresso/10 bg-white p-6 text-center shadow-[0_24px_65px_rgba(46,26,17,0.10)]">
          <h1 className="text-xl font-black text-espresso">Page update required</h1>
          <p className="mt-2 text-sm leading-relaxed text-espresso/60">
            The app loaded an old page file. Refresh to load the latest version.
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
          </ChunkErrorBoundary>
        </BrowserRouter>
      </StyledAlertProvider>
    </AuthProvider>
  );
}

export default App;
