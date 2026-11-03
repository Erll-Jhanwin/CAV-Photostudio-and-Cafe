import React from 'react';
import { isChunkLoadError } from '../utils/lazyWithRetry';

export class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('CAV route render error', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    if (isChunkLoadError(this.state.error)) {
      // React.lazy caches a rejected import promise. Reload the exact URL so the
      // browser retries the route asset instead of rendering the cached failure.
      (this.props.onRetryChunkLoad || (() => window.location.reload()))();
      return;
    }
    this.setState(previous => ({ error: null, retryKey: previous.retryKey + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
    }

    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-espresso/10 bg-white p-6 text-center shadow-[0_24px_65px_rgba(46,26,17,0.10)]">
          <h1 className="text-xl font-black text-espresso">This page didn’t load</h1>
          <p className="mt-2 text-sm leading-relaxed text-espresso/60">A screen component did not finish rendering. Your session and current URL are unchanged.</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-espresso shadow-[0_14px_34px_rgba(212,175,55,0.22)] transition-all hover:-translate-y-0.5 hover:bg-gold-light"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}
