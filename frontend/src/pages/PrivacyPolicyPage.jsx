import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Database,
  Lock,
  ShieldCheck,
  UserCheck,
  FileText,
} from 'lucide-react';

const policySections = [
  {
    title: 'Data We Collect',
    icon: Database,
    items: [
      'Customer account details such as name, username, email, and contact information.',
      'Booking details including selected package, schedule, notes, and booking status.',
      'Payment transaction records such as payment method, amount paid, and GCash reference number when applicable.',
      'POS transaction records, inventory records, chatbot questions, and system audit logs.',
    ],
  },
  {
    title: 'How Data Is Used',
    icon: FileText,
    items: [
      'To manage bookings, customer accounts, POS payments, notifications, and service updates.',
      'To operate inventory, ingredient recipes, stock alerts, analytics, forecasts, and reports.',
      'To support staff/admin accountability through audit logs and authorized business records.',
      'To improve support through FAQ and chatbot interactions.',
    ],
  },
  {
    title: 'How Data Is Protected',
    icon: Lock,
    items: [
      'Role-based access separates customer, staff, and admin permissions.',
      'Protected login sessions and server-side validation reduce unauthorized access.',
      'Important staff and admin actions are recorded in audit logs.',
      'Production deployment should use HTTPS, secure environment variables, restricted database access, and regular backups.',
    ],
  },
  {
    title: 'Your Responsibilities',
    icon: UserCheck,
    items: [
      'Keep login credentials private and use strong passwords.',
      'Log out when using shared devices.',
      'Provide accurate booking and payment information.',
      'Report suspicious account activity or incorrect records to CAV staff.',
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-cream text-espresso">
      <header className="sticky top-0 z-40 bg-cream/85 backdrop-blur-xl border-b border-espresso/[0.06]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="rounded-xl bg-espresso p-2 text-gold">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <p className="font-sans text-lg font-black leading-none">CAV</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-espresso/45">Privacy Center</p>
            </div>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-2xl border border-espresso/10 bg-white px-4 py-2 text-xs font-black text-espresso transition-all hover:bg-cream-dark"
          >
            <ArrowLeft className="h-4 w-4" />
            Back Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-10">
        <section className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)] lg:items-stretch">
            <div className="rounded-3xl bg-white p-6 shadow-[0_18px_45px_rgba(46,26,17,0.07)] md:p-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-gold/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-gold-dark">
              <ShieldCheck className="h-4 w-4" />
              Security and Privacy
            </div>
            <h1 className="mt-4 font-sans text-3xl font-black leading-tight text-espresso md:text-5xl">
              How CAV protects customer and business data
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-espresso/65 md:text-base">
              CAV Photo Studio & Cafe collects only the information needed to operate bookings, payments, accounts, inventory, support, and analytics. This policy explains how data is used and what safeguards help keep it protected.
            </p>
            </div>
            <div className="flex h-full flex-col justify-center rounded-3xl border border-espresso/[0.06] bg-white p-6 shadow-[0_18px_45px_rgba(46,26,17,0.06)]">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-espresso/45">Important Note</p>
              <p className="mt-2 text-sm leading-6 text-espresso/65">
                No website can promise absolute security. CAV reduces risk through authenticated access, role-based permissions, validation, audit trails, secure deployment practices, and responsible staff/admin access.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {policySections.map(({ title, icon: Icon, items }) => (
              <article key={title} className="flex h-full flex-col rounded-2xl border border-espresso/[0.06] bg-white p-5 shadow-[0_18px_45px_rgba(46,26,17,0.06)]">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cream-dark text-gold-dark">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 className="font-sans text-lg font-black text-espresso">{title}</h2>
                </div>
                <ul className="space-y-2.5">
                  {items.map(item => (
                    <li key={item} className="flex gap-2 text-sm leading-6 text-espresso/65">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-3xl bg-espresso p-5 text-cream shadow-[0_28px_70px_rgba(46,26,17,0.18)] md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">Payment Data</p>
              <p className="mt-2 text-sm leading-6 text-cream/70">
                CAV records payment method, amount, and GCash reference numbers for verification. Full card details are not stored because card payments are not supported.
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">Data Sharing</p>
              <p className="mt-2 text-sm leading-6 text-cream/70">
                Customer data is not sold, rented, or traded. It may only be shared when required by law, needed to operate the system securely, or approved by the user.
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">Data Retention</p>
              <p className="mt-2 text-sm leading-6 text-cream/70">
                Records may be retained for booking history, payment verification, reports, inventory tracking, audit logs, accounting, and legal requirements.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-gold/25 bg-gold/10 p-5">
          <p className="text-sm font-bold text-espresso">
            By using this website, you agree that CAV may collect and process information only for booking, payment verification, account management, inventory, analytics, support, and service operations described in this policy.
          </p>
        </section>
      </main>
    </div>
  );
}
