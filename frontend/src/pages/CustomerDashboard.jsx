import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { Calendar, User, Clock, Bell, LogOut, CheckCircle, MessageSquare, X, Coffee, Plus, ShoppingBag, Send, ChevronLeft, ChevronRight, Camera, Check, Heart, Cake, Sparkles, Users, MapPin, Eye, CreditCard, XCircle, RotateCcw, Download, Star, Hourglass, BadgeCheck, Ban, QrCode, Upload, ReceiptText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Input, Select, Textarea } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import { MobileHeader } from '../components/ui/MobileHeader';
import { Modal } from '../components/ui/Modal';

const getPackageIcon = (name) => {
  const n = name.toLowerCase();
  if (n.includes('solo')) return <User className="w-4 h-4" />;
  if (n.includes('couple') || n.includes('mr. & ms.')) return <Heart className="w-4 h-4" />;
  if (n.includes('friends')) return <Users className="w-4 h-4" />;
  if (n.includes('family')) return <Users className="w-4 h-4" />;
  if (n.includes('birthday')) return <Cake className="w-4 h-4" />;
  return <Sparkles className="w-4 h-4" />;
};

const parseDescription = (description) => {
  if (!description) return { persons: null, shots: null, isSplit: false, fullText: '' };
  if (description.includes('/')) {
    const [p, s] = description.split('/');
    return {
      persons: p.trim(),
      shots: s.trim(),
      isSplit: true
    };
  }
  return {
    fullText: description,
    isSplit: false
  };
};

const bookingFlowSteps = ['Booked', 'Confirmed', 'Payment', 'Completed'];

const getBookingStage = (status) => {
  switch (status) {
    case 'CONFIRMED': return 1;
    case 'CONFIRMED_DP': return 2;
    case 'COMPLETED': return 3;
    case 'CANCELLED': return -1;
    case 'PENDING':
    default: return 0;
  }
};

const getStatusMeta = (status) => {
  switch (status) {
    case 'CONFIRMED':
    case 'CONFIRMED_DP':
      return {
        icon: BadgeCheck,
        className: status === 'CONFIRMED_DP' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200',
      };
    case 'COMPLETED':
      return {
        icon: CheckCircle,
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'CANCELLED':
      return {
        icon: Ban,
        className: 'bg-red-50 text-red-700 border-red-200',
      };
    case 'PENDING':
    default:
      return {
        icon: Hourglass,
        className: 'bg-amber-50 text-amber-700 border-amber-200',
      };
  }
};

const getBookingActions = (status) => {
  switch (status) {
    case 'CONFIRMED':
    case 'CONFIRMED_DP':
      return [
        { label: 'View Details', icon: Eye, primary: true },
        { label: 'Reschedule', icon: RotateCcw },
      ];
    case 'COMPLETED':
      return [
        { label: 'View Details', icon: Eye, primary: true },
        { label: 'Download Receipt', icon: Download },
        { label: 'Leave Review', icon: Star },
      ];
    case 'CANCELLED':
      return [
        { label: 'View Details', icon: Eye, primary: true },
      ];
    case 'PENDING':
    default:
      return [
        { label: 'View Details', icon: Eye, primary: true },
        { label: 'Pay Now', icon: CreditCard },
        { label: 'Cancel Booking', icon: XCircle, danger: true },
      ];
  }
};

const formatPeso = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})}`;

const DOWN_PAYMENT_RATE = 0.5;
const calculateDownPayment = (price) => Number(price || 0) * DOWN_PAYMENT_RATE;
const formatStatusLabel = (status) => ({
  CONFIRMED_DP: 'Confirmed - Down Payment Received',
  PENDING_VERIFICATION: 'Pending Verification',
}[status] || status);

const getDateInputValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return localDate.toISOString().slice(0, 10);
};

const getTimeInputValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return localDate.toISOString().slice(11, 16);
};

const getMonthValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const getMonthLabel = (monthValue) => {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const getCalendarDays = (monthValue) => {
  const [year, month] = monthValue.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const blanks = Array.from({ length: firstDay.getDay() }, (_, index) => ({ key: `blank-${index}`, blank: true }));
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month - 1, day);
    return {
      key: getDateInputValue(date),
      day,
      date: getDateInputValue(date),
    };
  });
  return [...blanks, ...days];
};

const shiftMonth = (monthValue, offset) => {
  const [year, month] = monthValue.split('-').map(Number);
  return getMonthValue(new Date(year, month - 1 + offset, 1));
};

function CustomerSkeleton() {
  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <aside className="hidden md:flex w-64 bg-espresso flex-col p-5 shrink-0">
        <Skeleton className="h-12 w-full rounded-xl bg-white/10" />
        <SkeletonProfileCard />
        <div className="flex-1 space-y-2 my-6">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-11 w-full rounded-xl bg-white/5" />)}
        </div>
        <Skeleton className="h-10 w-full rounded-xl bg-white/5" />
      </aside>
      <main className="flex-1 p-6 md:p-10">
        <Skeleton className="h-8 w-56 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-espresso/5 space-y-4">
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-4">
            <div className="bg-white rounded-2xl p-6 border border-espresso/5 space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CustomerDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('book');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [points, setPoints] = useState(0);
  const [loyaltyTier, setLoyaltyTier] = useState('Bronze');

  const [selectedService, setSelectedService] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [notes, setNotes] = useState('');
  const [bookingAddons, setBookingAddons] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [packageSlide, setPackageSlide] = useState(0);
  const [cardsPerSlide, setCardsPerSlide] = useState(2);
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getDateInputValue());
  const [paymentTime, setPaymentTime] = useState(getTimeInputValue());
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [gcashQrMissing, setGcashQrMissing] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(getMonthValue());
  const [monthAvailability, setMonthAvailability] = useState({});
  const [dayAvailability, setDayAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [slotLoading, setSlotLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');

  useEffect(() => {
    const handleResize = () => setCardsPerSlide(window.innerWidth < 640 ? 1 : 2);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (selectedPackage) {
      setPaymentAmount(calculateDownPayment(selectedPackage.price).toFixed(2));
      setGcashQrMissing(false);
    }
  }, [selectedPackage]);

  const availableAddons = [
    { name: 'Extra Pax (1 Person)', price: 150.00 },
    { name: 'All Raw Soft Copies (USB)', price: 300.00 },
    { name: 'Premium A4 Print & Frame', price: 250.00 },
    { name: 'Professional Make-up Artist', price: 1200.00 }
  ];

  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! I am your CAV AI assistant. How can I help you today? You can ask me about studio rooms, slots, packages, or coffee!' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const canGoNext = useCallback(() => {
    if (currentStep === 1) {
      return !!selectedService;
    }
    if (currentStep === 2) {
      if (selectedService?.packages && selectedService.packages.length > 0) {
        return !!selectedPackage && !!selectedDate && !!selectedTime;
      }
      return !!selectedDate && !!selectedTime;
    }
    if (currentStep === 3) return true;
    if (currentStep === 4) return true;
    return false;
  }, [currentStep, selectedService, selectedPackage, selectedDate, selectedTime]);

  useEffect(() => {
    if (chatOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeTab !== 'book') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowRight') {
        if (currentStep < 4 && canGoNext()) {
          setCurrentStep(prev => prev + 1);
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentStep > 1) {
          setCurrentStep(prev => prev - 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, activeTab, canGoNext]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchDashboardData();
  }, [user, navigate]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [servicesRes, bookingsRes, profileRes] = await Promise.all([
        client.get('/api/bookings/services/'),
        client.get('/api/bookings/'),
        client.get('/api/auth/profile/')
      ]);
      setServices(servicesRes.data);
      setBookings(bookingsRes.data);
      const p = profileRes.data;
      setFirstName(p.first_name || '');
      setLastName(p.last_name || '');
      setPhone(p.phone_number || '');
      setAddress(p.address || '');
      if (p.customer_profile) {
        setPoints(p.customer_profile.points || 0);
        setLoyaltyTier(p.customer_profile.loyalty_tier || 'Bronze');
      }
      const mockNotifications = [
        { id: 1, title: 'Welcome to CAV!', message: 'Enjoy 10% off on your first photo shoot session.', created_at: 'Just now', read: false }
      ];
      bookingsRes.data.forEach(b => {
        if (['CONFIRMED', 'CONFIRMED_DP'].includes(b.status)) {
          mockNotifications.push({
            id: `b-${b.id}`, title: 'Booking Confirmed',
            message: `Your session for ${b.package_details?.name} on ${b.scheduled_date} is confirmed!`,
            created_at: 'Earlier today', read: false
          });
        }
      });
      setNotifications(mockNotifications);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    try {
      await client.patch('/api/auth/profile/', {
        first_name: firstName, last_name: lastName,
        phone_number: phone, address
      });
      fetchDashboardData();
    } catch {
      alert('Failed to update profile.');
    }
  };

  const handleAddAddon = (addon) => {
    const existing = bookingAddons.find(a => a.name === addon.name);
    if (existing) {
      setBookingAddons(bookingAddons.map(a => a.name === addon.name ? { ...a, quantity: a.quantity + 1 } : a));
    } else {
      setBookingAddons([...bookingAddons, { ...addon, quantity: 1 }]);
    }
  };

  const handleRemoveAddon = (addonName) => {
    const existing = bookingAddons.find(a => a.name === addonName);
    if (!existing) return;
    if (existing.quantity > 1) {
      setBookingAddons(bookingAddons.map(a => a.name === addonName ? { ...a, quantity: a.quantity - 1 } : a));
    } else {
      setBookingAddons(bookingAddons.filter(a => a.name !== addonName));
    }
  };

  const handlePackageSelect = (pkg) => {
    setSelectedPackage(pkg);
    setSelectedDate('');
    setSelectedTime('');
    setDayAvailability(null);
    setCalendarMonth(getMonthValue());
  };

  const fetchMonthAvailability = useCallback(async () => {
    if (!selectedPackage) return;
    try {
      setAvailabilityLoading(true);
      setAvailabilityError('');
      const res = await client.get('/api/bookings/availability/', {
        params: { package: selectedPackage.id, month: calendarMonth }
      });
      const availabilityMap = {};
      res.data.dates?.forEach(day => {
        availabilityMap[day.date] = day;
      });
      setMonthAvailability(availabilityMap);
    } catch {
      setAvailabilityError('Could not load calendar availability.');
    } finally {
      setAvailabilityLoading(false);
    }
  }, [selectedPackage, calendarMonth]);

  const fetchDayAvailability = useCallback(async (dateValue = selectedDate) => {
    if (!selectedPackage || !dateValue) return null;
    try {
      setSlotLoading(true);
      setAvailabilityError('');
      const res = await client.get('/api/bookings/availability/', {
        params: { package: selectedPackage.id, date: dateValue }
      });
      setDayAvailability(res.data);
      setSelectedTime(current => (
        current && !res.data.slots?.some(slot => slot.time === current && slot.available) ? '' : current
      ));
      return res.data;
    } catch {
      setAvailabilityError('Could not load time-slot availability.');
      return null;
    } finally {
      setSlotLoading(false);
    }
  }, [selectedPackage, selectedDate]);

  const handleDateSelect = (dateValue) => {
    const dateStatus = monthAvailability[dateValue]?.status;
    if (!selectedPackage || dateStatus !== 'AVAILABLE') return;
    setSelectedDate(dateValue);
    setSelectedTime('');
  };

  useEffect(() => {
    fetchMonthAvailability();
  }, [fetchMonthAvailability]);

  useEffect(() => {
    if (selectedDate) {
      fetchDayAvailability(selectedDate);
    }
  }, [selectedDate, fetchDayAvailability]);

  const handleBookingSubmit = async () => {
    if (!selectedPackage || !selectedDate || !selectedTime) {
      alert('Please fill in all booking details.');
      return;
    }
    const requiredDownPayment = calculateDownPayment(selectedPackage.price);
    const paidAmount = Number(paymentAmount);
    if (!paymentReference.trim() || !paymentDate || !paymentTime || !paymentReceipt) {
      alert('Please complete the GCash payment proof fields and upload the receipt screenshot.');
      return;
    }
    if (!Number.isFinite(paidAmount) || paidAmount < requiredDownPayment) {
      alert(`Amount paid must be at least ${formatPeso(requiredDownPayment)}.`);
      return;
    }
    try {
      setPaymentSubmitting(true);
      const latestAvailability = await fetchDayAvailability(selectedDate);
      const latestSlot = latestAvailability?.slots?.find(slot => slot.time === selectedTime);
      if (!latestSlot?.available) {
        alert('This schedule is no longer available. Please choose another date or time slot.');
        setPaymentSubmitting(false);
        return;
      }
      const bookingRes = await client.post('/api/bookings/', {
        package: selectedPackage.id, scheduled_date: selectedDate,
        scheduled_time: selectedTime, notes,
        items: bookingAddons.map(a => ({ name: a.name, price: a.price, quantity: a.quantity }))
      });
      const paidAt = new Date(`${paymentDate}T${paymentTime}:00`);
      const paymentData = new FormData();
      paymentData.append('booking', bookingRes.data.id);
      paymentData.append('reference_number', paymentReference.trim());
      paymentData.append('amount', paidAmount.toFixed(2));
      paymentData.append('paid_at', paidAt.toISOString());
      paymentData.append('receipt', paymentReceipt);
      const paymentRes = await client.post('/api/bookings/payments/', paymentData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setBookingConfirmation({
        id: bookingRes.data?.id,
        packageName: selectedPackage.name,
        date: selectedDate,
        time: selectedTime,
        paymentReference: paymentRes.data?.reference_number,
        amount: paymentRes.data?.amount,
        paymentStatus: paymentRes.data?.status || 'PENDING_VERIFICATION',
      });
      setSelectedService(null); setSelectedPackage(null);
      setSelectedDate(''); setSelectedTime(''); setNotes(''); setBookingAddons([]);
      setPaymentReference('');
      setPaymentAmount('');
      setPaymentDate(getDateInputValue());
      setPaymentTime(getTimeInputValue());
      setPaymentReceipt(null);
      setCurrentStep(1);
      fetchDashboardData();
      setActiveTab('history');
    } catch (err) {
      const errorData = err.response?.data || {};
      alert(errorData.scheduled_time || errorData.amount || errorData.detail || 'Failed to submit booking payment.');
      if (err.response?.status === 409) {
        fetchDayAvailability(selectedDate);
        fetchMonthAvailability();
      }
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatMessages(p => [...p, { role: 'user', content: msg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await client.post('/api/chatbot/query/', { question: msg });
      setChatMessages(p => [...p, { role: 'assistant', content: res.data.response }]);
    } catch {
      setChatMessages(p => [...p, { role: 'assistant', content: 'I am having trouble connecting. Let me know if you need help with hours or locations!' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'CONFIRMED': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'CONFIRMED_DP': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'COMPLETED': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'CANCELLED': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const handleLogout = useCallback(() => { logout(); navigate('/login', { replace: true }); }, [logout, navigate]);

  if (loading) return <CustomerSkeleton />;

  const navItems = [
    { key: 'book', label: 'Book a Session', icon: Plus, active: activeTab === 'book', onClick: () => setActiveTab('book') },
    { key: 'history', label: 'Booking History', icon: Clock, active: activeTab === 'history', onClick: () => setActiveTab('history') },
    { key: 'profile', label: 'My Profile', icon: User, active: activeTab === 'profile', onClick: () => setActiveTab('profile') },
    { key: 'notifications', label: 'Notifications', icon: Bell, active: activeTab === 'notifications', onClick: () => setActiveTab('notifications'),
      badge: notifications.length },
  ];

  const pageTitles = { book: 'Book a Session', history: 'Booking History', profile: 'My Profile', notifications: 'Notifications' };

  const totalCart = selectedPackage
    ? parseFloat(selectedPackage.price) + bookingAddons.reduce((acc, a) => acc + (a.price * a.quantity), 0)
    : 0;
  const requiredDownPayment = selectedPackage ? calculateDownPayment(selectedPackage.price) : 0;
  const calendarDays = getCalendarDays(calendarMonth);
  const selectedDaySlots = dayAvailability?.date === selectedDate ? (dayAvailability.slots || []) : [];
  const availableSlotsCount = selectedDaySlots.filter(slot => slot.available).length;
  const getBookingTotal = (booking) => (
    parseFloat(booking.package_details?.price || 0) +
    (booking.items?.reduce((acc, item) => acc + (parseFloat(item.price) * item.quantity), 0) || 0)
  );

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <Sidebar
        brand="CAV Portal"
        brandSubtitle="Customer Console"
        brandIcon={Calendar}
        navItems={navItems}
        user={user}
        onLogout={() => setSignOutOpen(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        signOutOpen={signOutOpen}
        onSignOutCancel={() => setSignOutOpen(false)}
        onSignOutConfirm={handleLogout}
      />

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} />

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto scrollbar-thin">
          {/* BOOK SESSION */}
          {activeTab === 'book' && (
            <div className="space-y-6 animate-in-up" key="book">
              <div>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Book a Photography Session</h1>
                <p className="text-xs text-espresso/50 mt-1">Reserve your premium studio slot or custom event package below.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left column: Sliding Stepper */}
                <div className="lg:col-span-8">
                  <Card className="flex flex-col h-[580px] max-h-[580px] overflow-hidden" padding={true}>
                    {/* Stepper progress indicator */}
                    <div className="border-b border-espresso/5 pb-4 mb-4 shrink-0">
                      {/* Mobile progress indicator */}
                      <div className="md:hidden flex flex-col gap-2">
                        <div className="flex justify-between text-[11px] font-bold text-espresso">
                          <span>Step {currentStep} of 4</span>
                          <span className="text-gold uppercase tracking-wider">
                            {currentStep === 1 && 'Choose Service'}
                            {currentStep === 2 && 'Package & Schedule'}
                            {currentStep === 3 && 'Add-ons & Notes'}
                            {currentStep === 4 && 'Review & Submit'}
                          </span>
                        </div>
                        <div className="w-full bg-cream rounded-full h-1.5">
                          <div 
                            className="bg-gold h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${(currentStep / 4) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Desktop progress indicator */}
                      <div className="hidden md:flex justify-between items-center relative px-2">
                        <div className="absolute top-4 left-6 right-6 h-0.5 bg-cream z-0" />
                        <div 
                          className="absolute top-4 left-6 h-0.5 bg-gold transition-all duration-500 z-0"
                          style={{ width: `${((currentStep - 1) / 3) * 88}%` }}
                        />
                        {[
                          { step: 1, label: 'Service' },
                          { step: 2, label: 'Package & Schedule' },
                          { step: 3, label: 'Add-ons' },
                          { step: 4, label: 'Review' }
                        ].map((s) => (
                          <button
                            key={s.step}
                            onClick={() => {
                              if (s.step < currentStep) {
                                setCurrentStep(s.step);
                              } else if (s.step > currentStep) {
                                let valid = true;
                                for (let check = currentStep; check < s.step; check++) {
                                  if (check === 1) {
                                    if (!selectedService) valid = false;
                                  }
                                  if (check === 2) {
                                    const isPkgOk = selectedService?.packages?.length > 0 ? !!selectedPackage : true;
                                    if (!isPkgOk || !selectedDate || !selectedTime) valid = false;
                                  }
                                }
                                if (valid) setCurrentStep(s.step);
                              }
                            }}
                            className="relative z-10 flex flex-col items-center gap-1.5 focus:outline-none"
                          >
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${
                              currentStep === s.step
                                ? 'bg-espresso text-gold border-gold scale-105 shadow-sm'
                                : currentStep > s.step
                                ? 'bg-gold text-cream border-gold'
                                : 'bg-white text-espresso/40 border-cream-dark'
                            }`}>
                              {s.step}
                            </span>
                            <span className={`text-[9px] uppercase font-extrabold tracking-widest transition-all duration-300 ${
                              currentStep === s.step ? 'text-espresso' : 'text-espresso/40'
                            }`}>
                              {s.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Middle: Sliding steps view area */}
                    <div className="relative flex-1 overflow-hidden">
                      <div 
                        className="flex transition-transform duration-500 ease-in-out h-full"
                        style={{ transform: `translateX(-${(currentStep - 1) * 25}%)`, width: '400%' }}
                      >
                        {/* Step 1: Choose Service */}
                        <div className="w-[25%] shrink-0 h-full overflow-y-auto pr-1 pb-4 flex flex-col gap-5">
                          {/* Top Section: Service Cards */}
                          <div>
                            <h2 className="text-xs font-bold text-espresso/50 uppercase tracking-wider mb-3">Step 1: Choose Service</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {services.map(svc => (
                                <button key={svc.id}
                                  type="button"
                                  onClick={() => { 
                                    setSelectedService(svc); 
                                    setSelectedPackage(null); 
                                    setSelectedDate('');
                                    setSelectedTime('');
                                    setDayAvailability(null);
                                    setPackageSlide(0);
                                  }}
                                  className={`relative overflow-hidden rounded-2xl border-2 text-left flex flex-col transition-all duration-300 group ${
                                    selectedService?.id === svc.id 
                                      ? 'border-gold bg-gold/[0.04] shadow-md scale-[1.01]' 
                                      : 'border-espresso/10 hover:border-espresso/30 bg-white hover:shadow-sm'
                                  }`}
                                  aria-pressed={selectedService?.id === svc.id}
                                >
                                  {/* Hero image */}
                                  <div className="relative w-full h-28 bg-cream overflow-hidden shrink-0">
                                    {svc.image_url ? (
                                      <img src={svc.image_url} alt={svc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                    ) : null}
                                    <div className="w-full h-full flex items-center justify-center text-4xl text-espresso/20"
                                      style={{ display: svc.image_url ? 'none' : 'flex' }}>
                                      <Camera className="w-8 h-8 text-espresso/30" />
                                    </div>
                                    {/* Session duration badge */}
                                    {svc.duration_minutes && (
                                      <span className="absolute top-2.5 right-2.5 bg-espresso/80 text-cream text-[9px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm shadow-sm">
                                        {svc.duration_minutes} min
                                      </span>
                                    )}
                                    {/* Selected check icon */}
                                    {selectedService?.id === svc.id && (
                                      <span className="absolute top-2.5 left-2.5 bg-gold text-cream rounded-full p-0.5 shadow-md">
                                        <Check className="w-3 h-3" />
                                      </span>
                                    )}
                                  </div>
                                  
                                  {/* Card body */}
                                  <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                                    <div className="space-y-1">
                                      <h3 className="font-extrabold text-espresso text-sm leading-snug">{svc.name}</h3>
                                      <p className="text-[11px] text-espresso/60 font-light line-clamp-2 leading-relaxed">{svc.description}</p>
                                    </div>
                                    <div className="flex justify-between items-center pt-2 mt-auto border-t border-espresso/5">
                                      <span className="text-xs font-bold text-gold">From ₱{svc.base_price}</span>
                                      <span className={`text-[10px] font-extrabold px-3 py-1 rounded-lg uppercase tracking-wider transition-all duration-300 ${
                                        selectedService?.id === svc.id 
                                          ? 'bg-gold text-cream' 
                                          : 'bg-espresso/5 text-espresso/50 group-hover:bg-espresso/10'
                                      }`}>
                                        {selectedService?.id === svc.id ? 'Selected' : 'Select'}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Step 2: Select Package & Schedule */}
                        <div className="w-[25%] shrink-0 h-full overflow-y-auto pr-1 pb-4 flex flex-col gap-5">
                          {/* Packages Section */}
                          {selectedService ? (
                            selectedService.packages && selectedService.packages.length > 0 ? (
                              <div className="space-y-3 shrink-0">
                                <h3 className="text-xs font-bold text-espresso/50 uppercase tracking-wider">Step 2a: Select Your Package</h3>
                                {(() => {
                                  const packages = selectedService.packages;
                                  const slides = [];
                                  for (let i = 0; i < packages.length; i += cardsPerSlide) {
                                    slides.push(packages.slice(i, i + cardsPerSlide));
                                  }
                                  const totalSlides = Math.max(1, slides.length);
                                  const safeSlide = Math.min(packageSlide, totalSlides - 1);

                                  // Carousel navigation handlers
                                  const handlePrev = () => setPackageSlide(s => Math.max(0, s - 1));
                                  const handleNext = () => setPackageSlide(s => Math.min(totalSlides - 1, s + 1));

                                  // Slide keyboard navigation
                                  const handleCarouselKeyDown = (e) => {
                                    if (e.key === 'ArrowLeft') {
                                      handlePrev();
                                      e.stopPropagation();
                                    } else if (e.key === 'ArrowRight') {
                                      handleNext();
                                      e.stopPropagation();
                                    }
                                  };

                                  return (
                                    <div 
                                      className="relative flex flex-col focus:outline-none" 
                                      role="region" 
                                      aria-label="Package selection carousel"
                                      tabIndex={0}
                                      onKeyDown={handleCarouselKeyDown}
                                    >
                                      {/* Carousel slides container */}
                                      <div className="overflow-hidden rounded-2xl relative w-full">
                                        <div 
                                          className="flex transition-transform duration-400 ease-in-out"
                                          style={{ transform: `translateX(-${safeSlide * 100}%)` }}
                                          onTouchStart={e => { e.currentTarget.dataset.touchX = e.touches[0].clientX; }}
                                          onTouchEnd={e => {
                                            const start = parseFloat(e.currentTarget.dataset.touchX || '0');
                                            const diff = start - e.changedTouches[0].clientX;
                                            if (Math.abs(diff) > 50) {
                                              if (diff > 0 && safeSlide < totalSlides - 1) handleNext();
                                              if (diff < 0 && safeSlide > 0) handlePrev();
                                            }
                                          }}
                                        >
                                          {slides.map((slidePkgs, si) => (
                                            <div key={si} className="flex shrink-0 w-full" style={{ flex: '0 0 100%' }}>
                                              {slidePkgs.map(pkg => {
                                                const parsed = parseDescription(pkg.description);
                                                const isSelected = selectedPackage?.id === pkg.id;
                                                return (
                                                  <div key={pkg.id} style={{ flex: `0 0 ${100 / cardsPerSlide}%` }} className="p-1.5">
                                                    <button
                                                      type="button"
                                                      onClick={() => handlePackageSelect(pkg)}
                                                      className={`w-full rounded-2xl border-2 text-left flex flex-col transition-all duration-300 h-full group/card relative ${
                                                        isSelected 
                                                          ? 'border-gold bg-gold/[0.04] shadow-md scale-[1.01]' 
                                                          : 'border-espresso/10 hover:border-espresso/30 bg-white hover:shadow-sm'
                                                      }`}
                                                      aria-pressed={isSelected}
                                                      aria-label={`Select ${pkg.name} package`}
                                                    >
                                                      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                                                        {/* Top row: Icon and Title */}
                                                        <div className="flex items-start gap-2.5">
                                                          <div className={`p-2 rounded-xl shrink-0 transition-colors duration-300 ${
                                                            isSelected ? 'bg-gold text-cream shadow-sm' : 'bg-cream text-espresso/40 group-hover/card:text-gold'
                                                          }`}>
                                                            {getPackageIcon(pkg.name)}
                                                          </div>
                                                          <div className="min-w-0 flex-1">
                                                            <h4 className="font-extrabold text-espresso text-xs tracking-tight leading-snug">{pkg.name}</h4>
                                                            {/* Small detail text */}
                                                            {parsed.isSplit ? (
                                                              <div className="flex gap-1.5 mt-1 text-[9px] font-bold text-espresso/50">
                                                                <span className="bg-cream px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 border border-espresso/5">
                                                                  <Users className="w-2.5 h-2.5 text-gold shrink-0" />
                                                                  {parsed.persons}
                                                                </span>
                                                                <span className="bg-cream px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 border border-espresso/5">
                                                                  <Camera className="w-2.5 h-2.5 text-gold shrink-0" />
                                                                  {parsed.shots}
                                                                </span>
                                                              </div>
                                                            ) : (
                                                              <p className="text-[10px] text-espresso/45 font-medium leading-relaxed mt-0.5">{pkg.description}</p>
                                                            )}
                                                          </div>
                                                          {isSelected && (
                                                            <span className="bg-gold text-cream rounded-full p-0.5 shrink-0 shadow-sm animate-in-scale">
                                                              <Check className="w-3 h-3" />
                                                            </span>
                                                          )}
                                                        </div>

                                                        {/* Middle row: Inclusions list/text */}
                                                        <p className="text-[10px] text-espresso/60 bg-cream-dark/30 p-2 rounded-xl font-light leading-relaxed flex-1 overflow-hidden line-clamp-3">
                                                          <strong>Inclusions:</strong> {pkg.inclusions}
                                                        </p>

                                                        {/* Bottom row: Price and select button */}
                                                        <div className="flex justify-between items-center pt-2 mt-auto border-t border-espresso/5 shrink-0">
                                                          <span className="text-gold font-extrabold text-xs">₱{pkg.price}</span>
                                                          <span className={`text-[9px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider transition-all duration-300 ${
                                                            isSelected 
                                                              ? 'bg-gold text-cream shadow-sm' 
                                                              : 'bg-espresso/5 text-espresso/50 group-hover/card:bg-espresso/10'
                                                          }`}>
                                                            {isSelected ? 'Selected' : 'Select'}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    </button>
                                                  </div>
                                                );
                                              })}
                                              {/* Fill empty card spot to prevent layout breaks on last slide */}
                                              {slidePkgs.length < cardsPerSlide && (
                                                <div style={{ flex: `0 0 ${100 / cardsPerSlide}%` }} className="p-1.5 invisible" />
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>

                                      {/* Carousel Pagination & Arrows Controls */}
                                      {totalSlides > 1 && (
                                        <div className="flex items-center justify-between mt-3 shrink-0">
                                          <button
                                            type="button"
                                            onClick={handlePrev}
                                            disabled={safeSlide === 0}
                                            className="p-1.5 rounded-lg border border-espresso/10 bg-white hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shrink-0"
                                            aria-label="Previous packages"
                                          >
                                            <ChevronLeft className="w-3.5 h-3.5 text-espresso" />
                                          </button>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-espresso/50">
                                              {safeSlide + 1} / {totalSlides}
                                            </span>
                                            <div className="flex items-center gap-1">
                                              {Array.from({ length: totalSlides }).map((_, di) => (
                                                <button
                                                  type="button"
                                                  key={di}
                                                  onClick={() => setPackageSlide(di)}
                                                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                                    di === safeSlide ? 'bg-gold w-4' : 'bg-espresso/25 hover:bg-espresso/45'
                                                  }`}
                                                  aria-label={`Go to slide ${di + 1}`}
                                                />
                                              ))}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={handleNext}
                                            disabled={safeSlide === totalSlides - 1}
                                            className="p-1.5 rounded-lg border border-espresso/10 bg-white hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shrink-0"
                                            aria-label="Next packages"
                                          >
                                            <ChevronRight className="w-3.5 h-3.5 text-espresso" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="bg-cream rounded-2xl p-4 text-center border border-espresso/5 space-y-1 mt-2 shrink-0">
                                <p className="font-bold text-espresso text-xs">No fixed packages needed</p>
                                <p className="text-[10px] text-espresso/50 max-w-sm mx-auto">This service is custom-scoped and operates at base rates or hourly pricing.</p>
                              </div>
                            )
                          ) : (
                            <div className="text-center py-8 border border-dashed border-espresso/15 rounded-2xl bg-cream/20 my-auto">
                              <p className="text-xs text-espresso/45">Go back and select a service in Step 1.</p>
                            </div>
                          )}

                          {/* Date and Time Section */}
                          <div className="border-t border-espresso/5 pt-4 space-y-3">
                            <h3 className="text-xs font-bold text-espresso/50 uppercase tracking-wider">Step 2b: Schedule Date &amp; Time</h3>
                            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
                              <div className="rounded-2xl bg-white border border-espresso/10 p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                  <button
                                    type="button"
                                    onClick={() => setCalendarMonth(month => shiftMonth(month, -1))}
                                    disabled={calendarMonth <= getMonthValue()}
                                    className="p-2 rounded-xl border border-espresso/10 text-espresso hover:bg-cream disabled:opacity-35 disabled:cursor-not-allowed"
                                    aria-label="Previous month"
                                  >
                                    <ChevronLeft className="w-4 h-4" />
                                  </button>
                                  <div className="text-center">
                                    <p className="font-black text-sm text-espresso">{getMonthLabel(calendarMonth)}</p>
                                    <p className="text-[10px] text-espresso/45">{availabilityLoading ? 'Checking available dates...' : 'Live availability'}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setCalendarMonth(month => shiftMonth(month, 1))}
                                    className="p-2 rounded-xl border border-espresso/10 text-espresso hover:bg-cream"
                                    aria-label="Next month"
                                  >
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-black uppercase tracking-wider text-espresso/40 mb-2">
                                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}
                                </div>
                                <div className="grid grid-cols-7 gap-1.5">
                                  {calendarDays.map(day => {
                                    if (day.blank) return <span key={day.key} />;
                                    const meta = monthAvailability[day.date];
                                    const isSelected = selectedDate === day.date;
                                    const statusValue = meta?.status || 'UNAVAILABLE';
                                    const disabled = !selectedPackage || statusValue !== 'AVAILABLE';
                                    const statusClass = isSelected
                                      ? 'bg-espresso text-gold border-gold shadow-[0_10px_22px_rgba(46,26,17,0.18)]'
                                      : statusValue === 'AVAILABLE'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      : statusValue === 'FULLY_BOOKED'
                                      ? 'bg-red-50 text-red-500 border-red-100 cursor-not-allowed'
                                      : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed';
                                    return (
                                      <button
                                        key={day.date}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => handleDateSelect(day.date)}
                                        className={`min-h-12 rounded-2xl border text-xs font-black transition-all ${statusClass} disabled:hover:translate-y-0`}
                                        title={`${day.date} - ${statusValue.replace('_', ' ')}`}
                                      >
                                        <span>{day.day}</span>
                                        {statusValue === 'AVAILABLE' && <span className="block text-[8px] font-bold opacity-70">{meta?.available_count || 0} slots</span>}
                                        {statusValue === 'FULLY_BOOKED' && <span className="block text-[8px] font-bold opacity-70">Full</span>}
                                      </button>
                                    );
                                  })}
                                </div>

                                <div className="flex flex-wrap gap-2 mt-3 text-[10px] font-bold text-espresso/55">
                                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Available</span>
                                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-espresso" /> Selected</span>
                                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-300" /> Fully booked</span>
                                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /> Unavailable</span>
                                </div>
                              </div>

                              <div className="rounded-2xl bg-cream/60 border border-espresso/10 p-4 space-y-3">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-wider text-espresso/45">Selected Date</p>
                                  <p className="font-black text-espresso">{selectedDate || 'Choose an available date'}</p>
                                  {selectedDate && (
                                    <p className="text-[11px] text-espresso/50">{slotLoading ? 'Refreshing slots...' : `${availableSlotsCount} available time slot${availableSlotsCount === 1 ? '' : 's'}`}</p>
                                  )}
                                </div>

                                <label className="block space-y-2">
                                  <span className="text-xs font-bold uppercase tracking-[0.16em] block text-espresso/70">Pick a Time Slot</span>
                                  <select
                                    value={selectedTime}
                                    onChange={e => setSelectedTime(e.target.value)}
                                    disabled={!selectedDate || slotLoading || availableSlotsCount === 0}
                                    className="w-full bg-white/95 border border-espresso/10 rounded-[18px] px-4 py-3 text-sm text-espresso shadow-[0_10px_26px_rgba(46,26,17,0.04)] focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <option value="">{selectedDate ? 'Select available slot' : 'Select a date first'}</option>
                                    {selectedDaySlots.map(slot => (
                                      <option key={slot.time} value={slot.time} disabled={!slot.available}>
                                        {slot.label} {slot.available ? '' : slot.status === 'BOOKED' ? '- Booked' : '- Unavailable'}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <div className="grid grid-cols-2 gap-2">
                                  {selectedDaySlots.map(slot => (
                                    <button
                                      key={slot.time}
                                      type="button"
                                      disabled={!slot.available}
                                      onClick={() => setSelectedTime(slot.time)}
                                      className={`rounded-2xl border px-3 py-2 text-[11px] font-black transition-all ${
                                        selectedTime === slot.time
                                          ? 'bg-espresso text-gold border-gold'
                                          : slot.available
                                          ? 'bg-white text-espresso border-espresso/10 hover:border-gold hover:bg-gold/10'
                                          : 'bg-red-50 text-red-400 border-red-100 cursor-not-allowed'
                                      }`}
                                    >
                                      {slot.label}
                                      {!slot.available && <span className="block text-[9px]">{slot.status === 'BOOKED' ? 'Booked' : 'Unavailable'}</span>}
                                    </button>
                                  ))}
                                </div>

                                {availabilityError && <p className="text-[11px] font-bold text-red-600">{availabilityError}</p>}
                                {!selectedPackage && <p className="text-[11px] text-espresso/50">Select a package first to load live availability.</p>}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Step 3: Add-ons & Notes */}
                        <div className="w-[25%] shrink-0 h-full overflow-y-auto pr-1 pb-4 flex flex-col gap-4">
                          <div>
                            <h2 className="text-sm font-bold text-espresso mb-1">Customize Your Session</h2>
                            <p className="text-[11px] text-espresso/50">Add details or optional extras to improve your experience.</p>
                          </div>
                          
                          <div className="space-y-2">
                            <p className="text-[10px] font-bold text-espresso/50 uppercase tracking-wider">Add-ons (Optional)</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {availableAddons.map((addon, i) => (
                                <div key={i} className="bg-cream p-3 rounded-xl border border-espresso/5 flex justify-between items-center text-xs">
                                  <div>
                                    <p className="font-semibold">{addon.name}</p>
                                    <p className="text-gold font-bold">PHP {addon.price}</p>
                                  </div>
                                  <button onClick={() => handleAddAddon(addon)}
                                    className="bg-espresso text-gold hover:bg-espresso-light p-1.5 rounded-lg transition-colors">
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2">
                            <Textarea 
                              label="Special Instructions / Requests" 
                              value={notes} 
                              onChange={e => setNotes(e.target.value)}
                              placeholder="Backdrop colors, makeup artist needs, group sizes..." 
                              rows={3} 
                            />
                          </div>
                        </div>

                        {/* Step 4: Review & Submit */}
                        <div className="w-[25%] shrink-0 h-full overflow-y-auto pr-1 pb-4 flex flex-col gap-4">
                          <div>
                            <h2 className="text-sm font-bold text-espresso mb-1">Review &amp; Confirm Booking</h2>
                            <p className="text-[11px] text-espresso/50">Verify details before submitting your slot reservation request.</p>
                          </div>

                          <div className="bg-cream/45 p-4 rounded-xl border border-espresso/5 space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-y-2 border-b border-espresso/5 pb-2">
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40">Selected Service</p>
                                <p className="font-semibold">{selectedService?.name || '-'}</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40">Package Selected</p>
                                <p className="font-semibold">{selectedPackage?.name || 'Custom Package (No package selected)'}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-y-2 border-b border-espresso/5 pb-2">
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40">Schedule Date</p>
                                <p className="font-semibold flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-gold" />
                                  {selectedDate || 'No date picked'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40">Time Slot</p>
                                <p className="font-semibold flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-gold" />
                                  {selectedTime || 'No slot selected'}
                                </p>
                              </div>
                            </div>

                            {bookingAddons.length > 0 && (
                              <div className="border-b border-espresso/5 pb-2">
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40 mb-1">Custom Add-ons</p>
                                <div className="space-y-1">
                                  {bookingAddons.map((addon, idx) => (
                                    <div key={idx} className="flex justify-between text-[11px]">
                                      <span>{addon.name} (x{addon.quantity})</span>
                                      <span className="font-bold">PHP {addon.price * addon.quantity}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {notes && (
                              <div className="border-b border-espresso/5 pb-2">
                                <p className="text-[9px] uppercase tracking-wider text-espresso/40">Special Requests</p>
                                <p className="italic text-espresso/70 leading-relaxed font-light mt-0.5">{notes}</p>
                              </div>
                            )}

                            <div className="flex justify-between items-center text-sm pt-1">
                              <span className="font-bold">Estimated Grand Total:</span>
                              <span className="font-sans text-base font-black text-gold">PHP {totalCart}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-[190px_1fr] gap-4 bg-white rounded-2xl border border-espresso/10 p-4 shadow-sm">
                            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3 flex flex-col items-center justify-center text-center min-h-44">
                              {!gcashQrMissing ? (
                                <img
                                  src="/gcash-business-qr.png"
                                  alt="Official CAV GCash for Business QR code"
                                  className="w-36 h-36 object-contain rounded-xl bg-white border border-blue-100 p-2"
                                  onError={() => setGcashQrMissing(true)}
                                />
                              ) : (
                                <div className="w-36 h-36 rounded-xl bg-white border border-dashed border-blue-200 flex flex-col items-center justify-center text-blue-700 p-3">
                                  <QrCode className="w-8 h-8 mb-2" />
                                  <p className="text-[10px] font-black leading-tight">Upload official QR as public/gcash-business-qr.png</p>
                                </div>
                              )}
                              <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider mt-3">GCash for Business</p>
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-xl bg-cream/70 border border-espresso/5 p-3 text-xs space-y-1.5">
                                <div className="flex justify-between gap-3">
                                  <span className="font-bold text-espresso/60">Required down payment</span>
                                  <span className="font-black text-gold-dark">{formatPeso(requiredDownPayment)}</span>
                                </div>
                                <p className="text-[11px] text-espresso/55 leading-relaxed">
                                  Pay through the business GCash QR, then submit the exact reference and receipt screenshot. Staff will verify this in the merchant app before confirming the booking.
                                </p>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Input
                                  label="GCash Reference No."
                                  value={paymentReference}
                                  onChange={e => setPaymentReference(e.target.value)}
                                  placeholder="e.g. 1234567890123"
                                  required
                                />
                                <Input
                                  label="Amount Paid"
                                  type="number"
                                  min={requiredDownPayment}
                                  step="0.01"
                                  value={paymentAmount}
                                  onChange={e => setPaymentAmount(e.target.value)}
                                  required
                                />
                                <Input
                                  label="Payment Date"
                                  type="date"
                                  value={paymentDate}
                                  onChange={e => setPaymentDate(e.target.value)}
                                  required
                                />
                                <Input
                                  label="Payment Time"
                                  type="time"
                                  value={paymentTime}
                                  onChange={e => setPaymentTime(e.target.value)}
                                  required
                                />
                              </div>

                              <label className="block">
                                <span className="text-xs font-bold uppercase tracking-[0.16em] block text-espresso/70 mb-2">Receipt Screenshot</span>
                                <div className="rounded-2xl border border-dashed border-espresso/15 bg-cream/35 p-3 flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-white text-gold-dark flex items-center justify-center border border-espresso/5">
                                    <Upload className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={e => setPaymentReceipt(e.target.files?.[0] || null)}
                                      className="block w-full text-xs text-espresso file:mr-3 file:rounded-xl file:border-0 file:bg-espresso file:px-3 file:py-2 file:text-xs file:font-bold file:text-gold"
                                      required
                                    />
                                    <p className="text-[10px] text-espresso/45 mt-1 truncate">
                                      {paymentReceipt ? paymentReceipt.name : 'Upload the GCash receipt screenshot.'}
                                    </p>
                                  </div>
                                </div>
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom: Navigation controls */}
                    <div className="flex justify-between items-center border-t border-espresso/5 pt-4 mt-auto shrink-0">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setCurrentStep(prev => prev - 1)}
                        disabled={currentStep === 1}
                        className="px-5 text-xs"
                      >
                        Previous
                      </Button>
                      
                      {currentStep < 4 ? (
                        <Button 
                          variant="gold" 
                          size="sm" 
                          onClick={() => setCurrentStep(prev => prev + 1)}
                          disabled={!canGoNext()}
                          className="px-6 text-xs"
                        >
                          Next
                        </Button>
                      ) : (
                        <Button 
                          variant="gold" 
                          size="sm" 
                          onClick={handleBookingSubmit}
                          disabled={paymentSubmitting}
                          className="px-6 text-xs bg-emerald-600 border-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {paymentSubmitting ? 'Submitting...' : 'Submit Reservation'}
                        </Button>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Right column: Summary sidebar */}
                <div className="lg:col-span-4">
                  <Card className="sticky top-6">
                    <CardHeader title="Cart Summary" />
                    {selectedService ? (
                      <div className="space-y-4 text-xs">
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase text-espresso/50 font-bold">Service</p>
                          <p className="font-semibold text-espresso">{selectedService?.name}</p>
                        </div>
                        {selectedPackage && (
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase text-espresso/50 font-bold">Package</p>
                            <p className="font-semibold text-espresso">{selectedPackage.name}</p>
                            <div className="flex justify-between font-bold text-gold text-xs mt-0.5">
                              <span>Base Rate:</span>
                              <span>PHP {selectedPackage.price}</span>
                            </div>
                          </div>
                        )}

                        {bookingAddons.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-espresso/5">
                            <p className="text-[10px] uppercase text-espresso/50 font-bold">Add-ons</p>
                            {bookingAddons.map((addon, i) => (
                              <div key={i} className="flex justify-between items-center text-espresso/80">
                                <span>{addon.name} x{addon.quantity}</span>
                                <div className="flex items-center gap-1.5">
                                  <span>PHP {addon.price * addon.quantity}</span>
                                  <button onClick={() => handleRemoveAddon(addon.name)}
                                    className="text-red-400 hover:text-red-600 font-bold text-sm leading-none">×</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedDate && selectedTime && (
                          <div className="bg-cream p-3 rounded-xl border border-espresso/5 space-y-1.5 text-[11px]">
                            <div className="flex items-center gap-2 text-espresso/60">
                              <Calendar className="w-3.5 h-3.5 text-gold" />
                              <span>{selectedDate}</span>
                            </div>
                            <div className="flex items-center gap-2 text-espresso/60">
                              <Clock className="w-3.5 h-3.5 text-gold" />
                              <span>{selectedTime.slice(0, 5)}</span>
                            </div>
                          </div>
                        )}

                        <div className="border-t border-espresso/10 pt-4 space-y-2">
                          <div className="flex justify-between items-center font-bold text-sm">
                            <span>Total:</span>
                            <span className="font-sans text-base text-espresso">PHP {totalCart}</span>
                          </div>
                          {selectedPackage && (
                            <div className="flex justify-between items-center rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11px] font-black text-emerald-700">
                              <span>Required Down Payment</span>
                              <span>{formatPeso(requiredDownPayment)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5 text-sm">
                        <div className="bg-cream rounded-2xl p-5 border border-espresso/5 text-center space-y-3">
                          <div className="bg-gold/10 text-gold w-12 h-12 mx-auto rounded-2xl flex items-center justify-center animate-pulse">
                            <ShoppingBag className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-extrabold text-espresso text-xs">Ready to book?</p>
                            <p className="text-[11px] text-espresso/50 mt-1">Configure your photoshoot session using the stepper wizard.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* BOOKING HISTORY */}
          {activeTab === 'history' && (
            <div className="max-w-[1520px] mx-auto space-y-6 md:space-y-8 animate-in-up" key="history">
              <div>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso leading-tight">Booking History</h1>
                <p className="text-xs text-espresso/55 mt-1">Track reservations, schedules, add-ons, and booking progress.</p>
              </div>

              {bookings.length > 0 ? (
                <div className="space-y-6 md:space-y-8">
                  {bookings.map((b, i) => (
                      <div key={b.id} className="group rounded-[20px] bg-white/85 backdrop-blur-xl border border-espresso/[0.07] shadow-[0_18px_44px_rgba(46,26,17,0.075),0_3px_12px_rgba(46,26,17,0.04)] hover:shadow-[0_28px_70px_rgba(46,26,17,0.12),0_8px_18px_rgba(46,26,17,0.05)] hover:-translate-y-0.5 transition-all duration-300 p-4 md:p-5 animate-in-up" style={{ animationDelay: `${i * 45}ms` }}>
                        {(() => {
                          const statusMeta = getStatusMeta(b.status);
                          const StatusIcon = statusMeta.icon;
                          const stage = getBookingStage(b.status);
                          const actions = getBookingActions(b.status);
                          return (
                            <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,1.1fr)_minmax(300px,1fr)_240px] gap-4 md:gap-5 items-stretch">
                              <div className="flex gap-4 min-w-0">
                                <div className="w-20 h-20 md:w-24 md:h-24 rounded-[18px] bg-gradient-to-br from-cream-dark to-white border border-espresso/[0.06] shadow-inner overflow-hidden shrink-0 flex items-center justify-center">
                                  <Camera className="w-8 h-8 text-gold-dark/70" />
                                </div>
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex items-start gap-2 flex-wrap">
                                    <h3 className="text-base md:text-lg font-black text-espresso leading-snug">{b.package_details?.name || 'Photography Package'}</h3>
                                    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[10px] font-black border ${statusMeta.className}`}>
                                      <StatusIcon className="w-3.5 h-3.5" />
                                      {formatStatusLabel(b.status)}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-espresso/65">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-gold-dark" />
                                      <strong className="text-espresso font-semibold">{b.scheduled_date}</strong>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5 text-gold-dark" />
                                      <strong className="text-espresso font-semibold">{b.scheduled_time}</strong>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 sm:col-span-2">
                                      <MapPin className="w-3.5 h-3.5 text-gold-dark" />
                                      <span>CAV Photo Studio &amp; Cafe</span>
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[18px] bg-cream/55 border border-espresso/[0.04] p-3 md:p-4 flex flex-col justify-center gap-4">
                                <div className="grid grid-cols-4 gap-2">
                                  {bookingFlowSteps.map((step, stepIndex) => {
                                    const isDone = stage >= stepIndex;
                                    const isCancelled = b.status === 'CANCELLED';
                                    return (
                                      <div key={step} className="relative flex flex-col items-center gap-1.5 text-center">
                                        {stepIndex < bookingFlowSteps.length - 1 && (
                                          <span className={`absolute top-3 left-1/2 w-full h-0.5 ${isDone && !isCancelled ? 'bg-gold' : 'bg-espresso/10'}`} />
                                        )}
                                        <span className={`relative z-10 w-6 h-6 rounded-full border flex items-center justify-center transition-all duration-300 ${
                                          isCancelled
                                            ? 'bg-red-50 border-red-200 text-red-600'
                                            : isDone
                                            ? 'bg-gold border-gold text-espresso shadow-[0_8px_18px_rgba(212,175,55,0.25)]'
                                            : 'bg-white border-espresso/10 text-espresso/30'
                                        }`}>
                                          {isDone && !isCancelled ? <Check className="w-3.5 h-3.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                                        </span>
                                        <span className={`text-[9px] font-black uppercase tracking-wide ${isDone && !isCancelled ? 'text-espresso' : 'text-espresso/35'}`}>{step}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {b.items?.length > 0 ? (
                                    b.items.map((item) => (
                                      <span key={`${item.name}-${item.id}`} className="inline-flex items-center rounded-full bg-white/80 border border-espresso/[0.06] px-3 py-1 text-[10px] font-bold text-espresso/70 shadow-sm">
                                        {item.name}{item.quantity > 1 ? ` x${item.quantity}` : ''}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="inline-flex items-center rounded-full bg-white/70 border border-espresso/[0.05] px-3 py-1 text-[10px] font-bold text-espresso/40">
                                      No add-ons
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row xl:flex-col gap-3 justify-between">
                                <div className="rounded-[18px] bg-gradient-to-br from-espresso to-espresso-dark text-cream p-4 min-w-36 shadow-[0_16px_36px_rgba(28,15,10,0.18)] flex-1 xl:flex-none">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-gold/80 font-black">Total</p>
                                  <p className="text-xl md:text-2xl font-black text-white mt-1">{formatPeso(getBookingTotal(b))}</p>
                                </div>
                                <div className="flex flex-wrap xl:flex-col gap-2 justify-end xl:justify-start">
                                  {actions.map((action) => {
                                    const ActionIcon = action.icon;
                                    return (
                                      <button
                                        key={action.label}
                                        type="button"
                                        aria-label={`${action.label} for ${b.package_details?.name || 'booking'}`}
                                        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3.5 py-2 text-[11px] font-black border transition-all duration-200 active:scale-[0.98] focus-visible:outline-gold ${
                                          action.primary
                                            ? 'bg-gold text-espresso border-gold hover:bg-gold-light shadow-[0_10px_24px_rgba(212,175,55,0.18)]'
                                            : action.danger
                                            ? 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100'
                                            : 'bg-white/85 text-espresso border-espresso/[0.08] hover:bg-cream-dark hover:-translate-y-0.5'
                                        }`}
                                      >
                                        <ActionIcon className="w-3.5 h-3.5" />
                                        {action.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="rounded-[24px] bg-white/85 backdrop-blur-xl border border-espresso/[0.06] shadow-[0_22px_60px_rgba(46,26,17,0.08)] p-8 md:p-12 text-center animate-in-up">
                  <div className="relative w-24 h-24 mx-auto mb-6">
                    <div className="absolute inset-0 rounded-[28px] bg-gold/15 animate-pulse" />
                    <div className="relative w-full h-full rounded-[28px] bg-cream-dark border border-espresso/[0.06] flex items-center justify-center text-gold-dark">
                      <Camera className="w-10 h-10" />
                    </div>
                  </div>
                  <h2 className="text-2xl font-black text-espresso">No bookings yet</h2>
                  <p className="text-sm text-espresso/55 mt-2 max-w-md mx-auto">Reserve your first studio session and your booking timeline will appear here.</p>
                  <Button variant="gold" size="lg" className="mt-6 rounded-2xl" onClick={() => setActiveTab('book')}>
                    Book Your First Session
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-in-up" key="profile">
              <div>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Account Profile</h1>
                <p className="text-xs text-espresso/50 mt-1">Update your personal details and check loyalty points.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-7">
                  <Card>
                    <CardHeader title="Personal Information" />
                    <form onSubmit={handleProfileUpdate} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="First Name" value={firstName} onChange={e => setFirstName(e.target.value)} />
                        <Input label="Last Name" value={lastName} onChange={e => setLastName(e.target.value)} />
                      </div>
                      <Input label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
                      <Textarea label="Address" value={address} onChange={e => setAddress(e.target.value)} rows={3} />
                      <div className="flex items-center gap-3 pt-2">
                        <Button type="submit" variant="primary">Save Changes</Button>
                        <Button type="button" variant="outline" size="sm" onClick={fetchDashboardData}>Cancel</Button>
                      </div>
                    </form>
                  </Card>
                  <div className="mt-4 bg-cream rounded-2xl border border-espresso/5 p-4 text-xs text-espresso/50">
                    <p className="font-semibold text-espresso mb-1">Account Security</p>
                    <p>Password and security settings can be managed by an administrator. Contact the café staff for password resets.</p>
                  </div>
                </div>

                <div className="md:col-span-5 space-y-4">
                  <div className="bg-gradient-to-br from-espresso to-espresso-dark rounded-3xl p-6 text-cream border border-white/5 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-gold/10 rounded-full blur-3xl" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full blur-2xl" />
                    <div className="relative z-10 space-y-5">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[9px] uppercase tracking-widest text-gold font-bold">Loyalty Card</p>
                          <h4 className="font-sans text-xl font-extrabold mt-1 text-white">{user?.username}</h4>
                        </div>
                        <span className="bg-gold/10 text-gold border border-gold/20 rounded-lg px-2.5 py-0.5 text-xs font-bold uppercase">{loyaltyTier}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-cream/50">Points Balance</p>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-sans font-black text-gold">{points}</span>
                          <span className="text-xs text-cream/50">PTS</span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-1.5 mt-3">
                          <div className="bg-gold h-1.5 rounded-full" style={{ width: `${Math.min((points % 100) / 100 * 100, 100)}%` }} />
                        </div>
                        <p className="text-[9px] text-cream/40">{100 - (points % 100)} pts until next reward tier</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl border border-espresso/5 shadow-sm p-4 text-xs space-y-3">
                    <p className="font-extrabold text-espresso">Member Benefits</p>
                    <div className="flex justify-between text-espresso/60">
                      <span>Photo sessions</span>
                      <span className="font-semibold text-espresso">{bookings.length} booked</span>
                    </div>
                    <div className="flex justify-between text-espresso/60">
                      <span>Cafe orders</span>
                      <span className="font-semibold text-espresso">-- via POS</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="space-y-6 animate-in-up" key="notifications">
              <div>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Your Notifications</h1>
                <p className="text-xs text-espresso/50 mt-1">Stay updated on your photo shoot approvals and promotions.</p>
              </div>

              {notifications.length > 0 ? (
                <div className="space-y-3">
                  {notifications.map((n, i) => (
                    <div key={n.id} className="bg-white p-5 rounded-2xl border border-espresso/5 shadow-sm flex items-start gap-4 hover:shadow-md transition-all animate-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                      <div className="bg-gold/10 text-gold-dark p-2.5 rounded-xl shrink-0">
                        <Bell className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-sm text-espresso">{n.title}</h4>
                        <p className="text-xs text-espresso/60 font-light">{n.message}</p>
                        <p className="text-[10px] text-espresso/30">{n.created_at}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Bell} title="No notifications" description="You're all caught up!" />
              )}
            </div>
          )}
        </main>

        <Modal
          open={!!bookingConfirmation}
          onClose={() => setBookingConfirmation(null)}
          title="Payment Submitted"
          size="sm"
        >
          <div className="space-y-5 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
              <CheckCircle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold text-espresso">Your reservation and GCash proof were submitted.</p>
              <p className="text-xs text-espresso/60 leading-relaxed">
                Your payment is pending verification. Staff will confirm the booking after checking the GCash merchant app.
              </p>
            </div>
            {bookingConfirmation && (
              <div className="bg-cream/60 rounded-2xl border border-espresso/5 p-4 text-left text-xs space-y-2">
                {bookingConfirmation.id && (
                  <div className="flex justify-between gap-3">
                    <span className="text-espresso/45 font-bold uppercase tracking-wider">Booking ID</span>
                    <span className="font-semibold text-espresso">#{bookingConfirmation.id}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-espresso/45 font-bold uppercase tracking-wider">Package</span>
                  <span className="font-semibold text-espresso text-right">{bookingConfirmation.packageName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-espresso/45 font-bold uppercase tracking-wider">Schedule</span>
                  <span className="font-semibold text-espresso text-right">{bookingConfirmation.date} at {bookingConfirmation.time}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-espresso/45 font-bold uppercase tracking-wider">GCash Ref</span>
                  <span className="font-semibold text-espresso text-right">{bookingConfirmation.paymentReference}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-espresso/45 font-bold uppercase tracking-wider">Amount</span>
                  <span className="font-semibold text-espresso text-right">{formatPeso(bookingConfirmation.amount)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-espresso/45 font-bold uppercase tracking-wider">Payment Status</span>
                  <span className="font-semibold text-amber-700 text-right">{formatStatusLabel(bookingConfirmation.paymentStatus)}</span>
                </div>
              </div>
            )}
            <Button variant="success" className="w-full" onClick={() => setBookingConfirmation(null)}>
              Got it
            </Button>
          </div>
        </Modal>

        {/* Floating Chatbot Widget */}
        <div className="fixed bottom-4 right-4 md:bottom-5 md:right-5 z-50">
          {!chatOpen ? (
            <button
              onClick={() => setChatOpen(true)}
              className="relative w-12 h-12 bg-espresso hover:bg-espresso-light text-gold rounded-full shadow-[0_16px_36px_rgba(28,15,10,0.28)] hover:scale-105 active:scale-95 transition-all border border-gold/25 flex items-center justify-center focus-visible:outline-gold"
              aria-label="Open chat"
            >
              <span className="absolute inset-0 rounded-full bg-gold/20 animate-ping" />
              <MessageSquare className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-72 sm:w-96 h-[480px] bg-white rounded-3xl shadow-2xl border border-espresso/10 flex flex-col overflow-hidden animate-in-up">
              <div className="bg-espresso text-cream px-4 py-3.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="bg-gold/15 text-gold p-1.5 rounded-lg">
                    <Coffee className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">CAV AI Assistant</h4>
                    <span className="text-[10px] text-gold/80">Online &middot; FAQ Assistant</span>
                  </div>
                </div>
                <button onClick={() => setChatOpen(false)} className="text-cream/50 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-cream/30 scrollbar-thin">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in`}>
                    <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-espresso text-cream rounded-tr-md'
                        : 'bg-white text-espresso rounded-tl-md border border-espresso/5'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start animate-in">
                    <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 border border-espresso/5 shadow-sm">
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                        <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} className="p-3 border-t border-espresso/10 bg-white shrink-0" aria-label="Chat form">
                <label htmlFor="cust-chat-input" className="block text-xs font-semibold text-espresso mb-1.5">Chat message</label>
                <div className="flex gap-2">
                  <input
                    id="cust-chat-input"
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="Ask about hours, pricing, packages..."
                    className="flex-1 bg-cream text-xs px-3.5 py-2.5 rounded-xl border border-espresso/5 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/20 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="bg-espresso text-gold hover:bg-espresso-light disabled:opacity-40 p-2.5 rounded-xl transition-all"
                    aria-label="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
