import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Menu,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { brandAssets, businessAssets } from '../utils/cavAssets';
import SiteFooter from '../components/SiteFooter';

const steps = [
  {
    number: '01',
    eyebrow: 'Start with the right fit',
    title: 'Choose your service',
    description: 'Pick the experience that matches your plans: a studio session for portraits and celebrations, or a full photo service booking for events.',
    icon: Camera,
    accent: 'bg-[#F8EECF] text-[#AA7C11]',
    visual: (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[#D7AD2D]/30 bg-[#FFFDF8] p-3 shadow-sm">
          <div className="flex items-center gap-2 text-[#170D09]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#170D09] text-[#D7AD2D]"><Camera className="h-4 w-4" /></span>
            <span className="text-xs font-black">Studio Session</span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#170D09]/55">Solo, couple, friends, family, or birthday packages.</p>
          <span className="mt-3 inline-flex rounded-full bg-[#F4EBDD] px-2.5 py-1 text-[10px] font-bold text-[#170D09]/60">From ₱1,000</span>
        </div>
        <div className="rounded-2xl border border-[#170D09]/10 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 text-[#170D09]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F4EBDD] text-[#170D09]/55"><Sparkles className="h-4 w-4" /></span>
            <span className="text-xs font-black">Photo Service</span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#170D09]/55">Event and extended photoshoot coverage.</p>
          <span className="mt-3 inline-flex rounded-full bg-[#F4EBDD] px-2.5 py-1 text-[10px] font-bold text-[#170D09]/60">From ₱2,500</span>
        </div>
      </div>
    ),
  },
  {
    number: '02',
    eyebrow: 'Find a time that works',
    title: 'Select a package and schedule',
    description: 'Choose the package you want, then browse the calendar and select an available date and time slot. Availability updates as you book.',
    icon: CalendarDays,
    accent: 'bg-[#E9F0EA] text-[#55735A]',
    visual: (
      <div className="rounded-2xl border border-[#170D09]/10 bg-[#FFFDF8] p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#170D09]/10 pb-3">
          <span className="text-xs font-black text-[#170D09]">October 2026</span>
          <span className="text-[10px] font-bold text-[#170D09]/45">Choose a date</span>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-[9px] font-bold text-[#170D09]/35">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-[#170D09]/65">
          {['', '', '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'].map((day, index) => (
            <span key={`${day}-${index}`} className={day === '15' ? 'flex h-6 items-center justify-center rounded-lg bg-[#170D09] text-[#D7AD2D]' : 'flex h-6 items-center justify-center'}>{day}</span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#F4EBDD] px-3 py-2 text-[10px] font-bold text-[#170D09]/65"><Clock3 className="h-3.5 w-3.5 text-[#AA7C11]" /> Available time slots appear after you choose a date.</div>
      </div>
    ),
  },
  {
    number: '03',
    eyebrow: 'Help us prepare for you',
    title: 'Add your customer details',
    description: 'Enter your name, email, phone number, and any notes that will help the CAV team prepare your session.',
    icon: UserRound,
    accent: 'bg-[#F5E7E4] text-[#9C5D4E]',
    visual: (
      <div className="space-y-3 rounded-2xl border border-[#170D09]/10 bg-[#FFFDF8] p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#170D09]/38">First name</span><div className="mt-1.5 h-9 rounded-xl border border-[#170D09]/10 bg-white" /></div>
          <div><span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#170D09]/38">Last name</span><div className="mt-1.5 h-9 rounded-xl border border-[#170D09]/10 bg-white" /></div>
        </div>
        <div><span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#170D09]/38">Email address</span><div className="mt-1.5 h-9 rounded-xl border border-[#170D09]/10 bg-white" /></div>
        <div><span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#170D09]/38">Notes (optional)</span><div className="mt-1.5 h-14 rounded-xl border border-[#170D09]/10 bg-white" /></div>
      </div>
    ),
  },
  {
    number: '04',
    eyebrow: 'Lock in your reservation',
    title: 'Review, pay, and confirm',
    description: 'Check your package, schedule, and contact details. Submit the required payment reference, then keep your confirmation for the day of your session.',
    icon: CreditCard,
    accent: 'bg-[#E8EEF4] text-[#52708D]',
    visual: (
      <div className="rounded-2xl border border-[#170D09]/10 bg-[#FFFDF8] p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#170D09]/10 pb-3">
          <span className="text-xs font-black text-[#170D09]">Booking summary</span>
          <ShieldCheck className="h-4 w-4 text-[#55735A]" />
        </div>
        <div className="space-y-3 py-4 text-[11px] text-[#170D09]/60">
          <div className="flex justify-between"><span>Solo Package</span><span className="font-black text-[#170D09]">₱1,000</span></div>
          <div className="flex justify-between"><span>15 Oct · 2:00 PM</span><span className="font-bold text-[#55735A]">Available</span></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-[#E9F0EA] px-3 py-2 text-[10px] font-black text-[#55735A]"><Check className="h-3.5 w-3.5" /> Payment received · Booking submitted</div>
      </div>
    ),
  },
];

export default function BookingGuidePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const handleBookNow = () => {
    if (user) navigate('/customer');
    else navigate('/login?redirect=book');
  };

  const navLinks = [
    { label: 'Home', to: '/' },
    { label: 'Photo Studio', to: '/photo-studio' },
    { label: 'Café Menu', to: '/cafe-menu' },
    { label: 'Gallery', to: '/gallery' },
    { label: 'How to Book', to: '/how-to-book' },
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#170D09] page-transition">
      <header className="sticky top-0 z-40 border-b border-[#170D09]/[0.08] bg-white shadow-[0_8px_24px_rgba(46,26,17,0.06)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4 md:h-[72px]">
            <Link to="/" className="flex min-w-0 items-center gap-3 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D7AD2D]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#170D09] shadow-[0_8px_18px_rgba(46,26,17,0.14)]"><img src={brandAssets.logo} alt="CAV logo" className="h-7 w-7 rounded-xl object-cover" /></span>
              <span className="min-w-0"><span className="block truncate text-lg font-black leading-tight text-[#170D09] md:text-xl">CAV</span><span className="hidden text-[9px] font-bold uppercase leading-tight tracking-[0.18em] text-[#AA7C11] sm:block">Studio &amp; Café</span></span>
            </Link>

            <nav className="hidden items-center gap-1 text-sm font-bold md:flex" aria-label="Main navigation">
              {navLinks.map((link) => <Link key={link.to} to={link.to} className={`rounded-2xl px-3.5 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D7AD2D] lg:px-4 ${link.to === '/how-to-book' ? 'bg-[#F4EBDD] text-[#170D09]' : 'text-[#170D09]/68 hover:bg-[#F4EBDD] hover:text-[#170D09]'}`}>{link.label}</Link>)}
            </nav>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Link to={user ? '/customer' : '/login'} className="hidden rounded-2xl px-3 py-2 text-sm font-bold text-[#170D09]/68 transition-colors hover:bg-[#F4EBDD] hover:text-[#170D09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D7AD2D] sm:block">{user ? 'Dashboard' : 'Login'}</Link>
              <button type="button" onClick={handleBookNow} className="hidden items-center gap-2 rounded-2xl bg-[#D7AD2D] px-4 py-2.5 text-sm font-black text-[#170D09] shadow-[0_8px_18px_rgba(215,173,45,0.2)] transition-all hover:-translate-y-0.5 hover:bg-[#E6C761] sm:inline-flex">Reserve <span className="hidden lg:inline">Your Session</span> <ArrowRight className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setMobileNavOpen(!mobileNavOpen)} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#170D09]/10 bg-white text-[#170D09] transition-colors hover:bg-[#F4EBDD] md:hidden" aria-expanded={mobileNavOpen} aria-label="Toggle navigation">{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
            </div>
          </div>
        </div>
        {mobileNavOpen && <div className="border-t border-[#170D09]/[0.08] bg-white md:hidden"><div className="mx-auto max-w-7xl space-y-1 px-4 py-3">{navLinks.map((link) => <Link key={link.to} to={link.to} onClick={() => setMobileNavOpen(false)} className={`block rounded-2xl px-4 py-3 text-sm font-bold ${link.to === '/how-to-book' ? 'bg-[#F4EBDD] text-[#170D09]' : 'text-[#170D09]/72 hover:bg-[#F4EBDD]'}`}>{link.label}</Link>)}<button type="button" onClick={() => { setMobileNavOpen(false); handleBookNow(); }} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D7AD2D] px-4 py-3 text-sm font-black text-[#170D09]">Reserve Your Session <ArrowRight className="h-4 w-4" /></button></div></div>}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#170D09] px-4 py-16 text-[#F4EBDD] sm:px-6 md:py-24 lg:py-28">
          <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#D7AD2D]/[0.12] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-40 left-1/4 h-80 w-80 rounded-full bg-[#D7AD2D]/[0.06] blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] lg:gap-20">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#D7AD2D]/25 bg-[#D7AD2D]/10 px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#D7AD2D]"><FileText className="h-3.5 w-3.5" /> Booking made simple</div>
              <h1 className="mt-6 text-5xl font-black leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl">Your next <span className="text-[#D7AD2D] italic">moment</span> starts here.</h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#F4EBDD]/68 sm:text-lg">A quick guide to booking your CAV studio session or photo service. Follow four simple steps and arrive ready to create.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={handleBookNow} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D7AD2D] px-5 py-3.5 text-sm font-black text-[#170D09] shadow-[0_16px_36px_rgba(215,173,45,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[#E6C761]">Start booking <ArrowRight className="h-4 w-4" /></button><a href="#booking-steps" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#F4EBDD]/20 px-5 py-3.5 text-sm font-bold text-[#F4EBDD] transition-colors hover:border-[#F4EBDD]/45 hover:bg-white/[0.06]">See the 4 steps <ChevronRight className="h-4 w-4" /></a></div>
            </div>
            <div className="relative mx-auto w-full max-w-[500px]">
              <div className="absolute -inset-3 rounded-[32px] border border-[#D7AD2D]/20" />
              <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#2b1710] shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
                <div className="relative h-[340px] overflow-hidden sm:h-[390px]"><img src={businessAssets.hero} alt="CAV studio interior" className="h-full w-full object-cover" style={{ objectPosition: '50% 32%' }} /><div className="absolute inset-0 bg-gradient-to-t from-[#170D09] via-[#170D09]/10 to-transparent" /><div className="absolute inset-x-5 bottom-5 sm:inset-x-7 sm:bottom-7"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D7AD2D]">Your booking path</p><div className="mt-3 flex items-center gap-2">{steps.map((step, index) => <React.Fragment key={step.number}><span className={`flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-black ${index === 0 ? 'border-[#D7AD2D] bg-[#D7AD2D] text-[#170D09]' : 'border-white/20 bg-white/10 text-white/70'}`}>{index === 0 ? <Check className="h-4 w-4" /> : step.number}</span>{index < steps.length - 1 && <span className="h-px flex-1 bg-white/20" />}</React.Fragment>)}</div></div></div>
                <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 text-xs sm:px-7"><span className="font-bold text-[#F4EBDD]/70">Takes about 5 minutes</span><span className="flex items-center gap-1.5 font-black text-[#D7AD2D]"><ShieldCheck className="h-3.5 w-3.5" /> Secure &amp; simple</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[#170D09]/10 bg-[#F4EBDD] px-4 py-5 sm:px-6"><div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 text-[10px] font-black uppercase tracking-[0.13em] text-[#170D09]/55 sm:grid-cols-4 sm:gap-0"><a href="#step-01" className="flex items-center gap-2 sm:border-r sm:border-[#170D09]/10 sm:px-5 first:sm:pl-0"><span className="text-[#AA7C11]">01</span> Choose service</a><a href="#step-02" className="flex items-center gap-2 sm:border-r sm:border-[#170D09]/10 sm:px-5"><span className="text-[#AA7C11]">02</span> Pick a time</a><a href="#step-03" className="flex items-center gap-2 sm:border-r sm:border-[#170D09]/10 sm:px-5"><span className="text-[#AA7C11]">03</span> Add details</a><a href="#step-04" className="flex items-center gap-2 sm:px-5 sm:last:pr-0"><span className="text-[#AA7C11]">04</span> Confirm</a></div></section>

        <section id="booking-steps" className="px-4 py-20 sm:px-6 md:py-28"><div className="mx-auto max-w-6xl"><div className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#AA7C11]">The booking flow</p><h2 className="mt-4 text-4xl font-black leading-tight text-[#170D09] sm:text-5xl">Four clear steps. One memorable session.</h2><p className="mt-5 text-base leading-7 text-[#170D09]/60">Everything you need is in one place. The booking screen saves your progress as you move through each step.</p></div><div className="relative mt-14 space-y-6 before:absolute before:bottom-8 before:left-6 before:top-8 before:hidden before:w-px before:bg-[#D7AD2D]/35 md:before:block">{steps.map((step) => { const Icon = step.icon; return <article id={`step-${step.number}`} key={step.number} className="relative grid gap-6 rounded-[28px] border border-[#170D09]/[0.08] bg-white p-5 shadow-[0_18px_50px_rgba(46,26,17,0.06)] md:grid-cols-[72px_minmax(0,1fr)_minmax(280px,0.72fr)] md:items-center md:gap-8 md:p-8"><div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#170D09] text-sm font-black text-[#D7AD2D] shadow-[0_8px_20px_rgba(23,13,9,0.16)] md:h-14 md:w-14">{step.number}</div><div><div className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-xl ${step.accent}`}><Icon className="h-4 w-4" /></span><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#AA7C11]">{step.eyebrow}</p></div><h3 className="mt-4 text-2xl font-black leading-tight text-[#170D09]">{step.title}</h3><p className="mt-3 max-w-xl text-sm leading-6 text-[#170D09]/60">{step.description}</p></div><div>{step.visual}</div></article>; })}</div></div></section>

        <section className="bg-[#F4EBDD] px-4 py-20 sm:px-6 md:py-24"><div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)] lg:items-center"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#AA7C11]">Before you begin</p><h2 className="mt-4 text-3xl font-black leading-tight text-[#170D09] sm:text-4xl">A few things to have ready.</h2><div className="mt-7 grid gap-4 sm:grid-cols-2"><div className="flex gap-3 rounded-2xl border border-[#170D09]/10 bg-white/70 p-4"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#AA7C11]" /><span className="text-sm leading-6 text-[#170D09]/65">Your preferred service and package</span></div><div className="flex gap-3 rounded-2xl border border-[#170D09]/10 bg-white/70 p-4"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#AA7C11]" /><span className="text-sm leading-6 text-[#170D09]/65">A date and time that works for you</span></div><div className="flex gap-3 rounded-2xl border border-[#170D09]/10 bg-white/70 p-4"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#AA7C11]" /><span className="text-sm leading-6 text-[#170D09]/65">An active email and phone number</span></div><div className="flex gap-3 rounded-2xl border border-[#170D09]/10 bg-white/70 p-4"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#AA7C11]" /><span className="text-sm leading-6 text-[#170D09]/65">Your payment reference after checkout</span></div></div></div><div className="rounded-[28px] bg-[#170D09] p-7 text-[#F4EBDD] shadow-[0_24px_60px_rgba(23,13,9,0.2)]"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#D7AD2D]/15 text-[#D7AD2D]"><Clock3 className="h-5 w-5" /></div><h3 className="mt-5 text-2xl font-black text-white">Need a hand?</h3><p className="mt-3 text-sm leading-6 text-[#F4EBDD]/65">Our team is happy to help you choose a package or answer a question before you reserve.</p><Link to="/photo-studio" className="mt-6 inline-flex items-center gap-2 text-sm font-black text-[#D7AD2D] hover:text-[#E6C761]">Explore packages <ArrowRight className="h-4 w-4" /></Link></div></div></section>

        <section className="relative overflow-hidden bg-[#170D09] px-4 py-16 text-center text-[#F4EBDD] sm:px-6 md:py-20"><div className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-[#D7AD2D]/10 blur-3xl" /><div className="relative mx-auto max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#D7AD2D]">Ready when you are</p><h2 className="mt-4 text-4xl font-black leading-tight text-white sm:text-5xl">Let&apos;s make something worth remembering.</h2><p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-[#F4EBDD]/62">Start your booking today and we&apos;ll take care of the details with you.</p><button type="button" onClick={handleBookNow} className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-[#D7AD2D] px-6 py-3.5 text-sm font-black text-[#170D09] shadow-[0_16px_36px_rgba(215,173,45,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[#E6C761]">Reserve your session <ArrowRight className="h-4 w-4" /></button></div></section>
      </main>

      <SiteFooter />
    </div>
  );
}
