import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock3, Mail, MapPin, MessageSquare } from 'lucide-react';
import { brandAssets } from '../utils/cavAssets';

const quickLinks = [
  { label: 'Home', to: '/' },
  { label: 'Photo Studio', to: '/photo-studio' },
  { label: 'Café Menu', to: '/cafe-menu' },
  { label: 'Gallery', to: '/gallery' },
  { label: 'How to Book', to: '/how-to-book' },
  { label: 'Our Story', to: '/our-story' },
];

const informationLinks = [
  { label: 'Access Account', to: '/login' },
  { label: 'Security & Privacy', to: '/privacy-policy' },
  { label: 'Book a Session', to: '/login?redirect=book' },
];

export default function SiteFooter({ onOpenChat, chatOpen = false }) {
  return (
    <>
      <section className="border-y border-[#170D09]/10 bg-[#F4EBDD] px-4 py-7 text-[#170D09] sm:px-6 md:py-8" aria-label="CAV contact information">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 text-sm sm:grid-cols-3 sm:gap-6">
          <div className="flex items-start gap-3 sm:justify-center">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#D7AD2D]" aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#170D09]/45">Visit CAV</p>
              <p className="mt-1 leading-5 text-[#170D09]/70">028B M.P. Casanova St., Tambo, Lipa City</p>
            </div>
          </div>
          <div className="flex items-start gap-3 sm:justify-center">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#D7AD2D]" aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#170D09]/45">Studio hours</p>
              <p className="mt-1 leading-5 text-[#170D09]/70">Daily, 9:00 AM – 7:00 PM PHT</p>
            </div>
          </div>
          <div className="flex items-start gap-3 sm:justify-center">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#D7AD2D]" aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#170D09]/45">Connect with us</p>
              <a href="mailto:cav.photostudio.cafe@gmail.com" className="mt-1 block break-all leading-5 text-[#170D09]/70 transition-colors hover:text-[#170D09]">
                cav.photostudio.cafe@gmail.com
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative overflow-hidden bg-[#170D09] px-4 pb-7 pt-14 text-[#F4EBDD] sm:px-6 md:pb-8 md:pt-16">
        <div className="pointer-events-none absolute -right-28 -top-32 h-80 w-80 rounded-full bg-[#D7AD2D]/[0.07] blur-3xl" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.65fr)_minmax(150px,0.75fr)_minmax(150px,0.75fr)] lg:gap-16">
            <div className="max-w-md">
              <Link to="/" className="group inline-flex items-center gap-4 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D7AD2D]">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[#D7AD2D]/35 bg-[#F4EBDD] p-1.5 shadow-[0_12px_35px_rgba(0,0,0,0.24)] transition-transform duration-300 group-hover:-translate-y-1">
                  <img src={brandAssets.logo} alt="CAV logo" className="h-full w-full rounded-xl object-cover" />
                </span>
                <span>
                  <span className="block font-sans text-2xl font-black leading-none tracking-tight text-white">CAV</span>
                  <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.22em] text-[#F4EBDD]/55">Studio &amp; Café</span>
                </span>
              </Link>
              <p className="mt-7 text-xs font-black uppercase tracking-[0.28em] text-[#D7AD2D]">Capture. Create. Connect.</p>
              <p className="mt-4 max-w-sm text-sm leading-7 text-[#F4EBDD]/62">
                A warm creative space where professional photography, specialty coffee, and meaningful moments come together.
              </p>
            </div>

            <nav aria-label="Quick links">
              <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#D7AD2D]">Quick Links</h2>
              <ul className="mt-5 space-y-3">
                {quickLinks.map(link => (
                  <li key={link.to}>
                    <Link to={link.to} className="group inline-flex items-center gap-1.5 text-sm text-[#F4EBDD]/65 transition-colors hover:text-white">
                      {link.label}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Information links">
              <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#D7AD2D]">Information</h2>
              <ul className="mt-5 space-y-3">
                {informationLinks.map(link => (
                  <li key={link.to}>
                    <Link to={link.to} className="group inline-flex items-center gap-1.5 text-sm text-[#F4EBDD]/65 transition-colors hover:text-white">
                      {link.label}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-[#F4EBDD]/10 pt-6 text-xs text-[#F4EBDD]/42 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 CAV Capstone Project. All rights reserved.</p>
            <p className="uppercase tracking-[0.16em]">Photo Studio &amp; Café · Lipa City</p>
          </div>
        </div>
      </footer>

      {!chatOpen && (onOpenChat ? (
        <button
          type="button"
          onClick={onOpenChat}
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-[#D7AD2D]/45 bg-[#170D09] text-[#D7AD2D] shadow-[0_16px_36px_rgba(23,13,9,0.34)] transition-all duration-300 hover:-translate-y-1 hover:bg-[#2a1710] hover:shadow-[0_20px_42px_rgba(23,13,9,0.42)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D7AD2D] md:bottom-5 md:right-5"
          aria-label="Open CAV chat"
        >
          <span className="absolute inset-0 rounded-full bg-[#D7AD2D]/15 animate-ping" />
          <MessageSquare className="relative h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <Link
          to="/"
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-[#D7AD2D]/45 bg-[#170D09] text-[#D7AD2D] shadow-[0_16px_36px_rgba(23,13,9,0.34)] transition-all duration-300 hover:-translate-y-1 hover:bg-[#2a1710] hover:shadow-[0_20px_42px_rgba(23,13,9,0.42)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D7AD2D] md:bottom-5 md:right-5"
          aria-label="Go to CAV chat"
        >
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
        </Link>
      ))}
    </>
  );
}
