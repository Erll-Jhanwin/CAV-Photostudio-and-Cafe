import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-5 py-16 text-espresso">
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-[0_24px_65px_rgba(46,26,17,0.10)]">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-gold-dark">404</p>
        <h1 className="mt-3 text-3xl font-black">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-espresso/70">The page you requested does not exist or may have moved.</p>
        <Link to="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-gold px-5 py-3 text-sm font-bold text-espresso focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
          Return to CAV home
        </Link>
      </div>
    </main>
  );
}
