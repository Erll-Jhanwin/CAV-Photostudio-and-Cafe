import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { Calendar, User, Clock, Bell, CheckCircle, MessageSquare, X, Coffee, Plus, ShoppingBag, Send, ChevronLeft, ChevronRight, Camera, Check, Heart, Cake, Sparkles, Users, MapPin, Eye, XCircle, RotateCcw, Download, Hourglass, BadgeCheck, Ban, QrCode, Upload, ReceiptText, Phone, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Input, Textarea } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import { MobileHeader } from '../components/ui/MobileHeader';
import { Modal } from '../components/ui/Modal';
import { ChatbotFaqPrompts, ChatbotMessageContent } from '../components/ui/ChatbotMessage';
import { useStyledConfirm } from '../components/ui/StyledAlert';

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

const splitPackageText = (text) => (
  String(text || '')
    .split(/\r?\n|,|;/)
    .map(item => item.trim())
    .filter(Boolean)
);

const getPackagePhotoOutputs = (pkg) => {
  const parsed = parseDescription(pkg?.description || '');
  const outputs = splitPackageText(pkg?.inclusions).filter(item => (
    /(shot|photo|soft cop|digital|print|retouch|layout|file)/i.test(item)
  ));
  if (parsed.shots && !outputs.some(item => item.toLowerCase().includes('shot'))) {
    outputs.unshift(parsed.shots);
  }
  return outputs.length ? outputs : ['Final outputs confirmed with staff based on session type'];
};

const getPackageGalleryCategory = (pkg, service) => {
  const text = `${pkg?.name || ''} ${pkg?.description || ''} ${service?.name || ''}`.toLowerCase();
  if (text.includes('event') || text.includes('birthday')) return 'EVENTS';
  return 'STUDIO';
};

const packageSampleFallbacks = [
  {
    id: 'sample-studio-portrait',
    category: 'STUDIO',
    title: 'Studio Portrait Sample',
    image_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=900',
    alt_text: 'Studio portrait sample',
  },
  {
    id: 'sample-studio-setup',
    category: 'STUDIO',
    title: 'Studio Lighting Setup',
    image_url: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=900',
    alt_text: 'Studio lighting and camera setup',
  },
  {
    id: 'sample-studio-family',
    category: 'STUDIO',
    title: 'Family Session Sample',
    image_url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=900',
    alt_text: 'Family photo session sample',
  },
  {
    id: 'sample-event',
    category: 'EVENTS',
    title: 'Event Session Sample',
    image_url: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=900',
    alt_text: 'Event photography sample',
  },
];

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

const getBookingActions = (booking) => {
  const status = booking?.status;
  const editAction = booking?.can_edit ? [{ key: 'edit', label: 'Refine Booking', icon: RotateCcw }] : [];
  const receiptAction = booking?.payments?.some(payment => payment.receipt_url)
    ? [{ key: 'receipt', label: 'Save Receipt', icon: Download }]
    : [];
  switch (status) {
    case 'CONFIRMED':
    case 'CONFIRMED_DP':
      return [
        { key: 'details', label: 'Review Details', icon: Eye, primary: true },
        ...editAction,
      ];
    case 'COMPLETED':
      return [
        { key: 'details', label: 'Review Details', icon: Eye, primary: true },
        ...receiptAction,
      ];
    case 'CANCELLED':
      return [
        { key: 'details', label: 'Review Details', icon: Eye, primary: true },
      ];
    case 'PENDING':
    default:
      return [
        { key: 'details', label: 'Review Details', icon: Eye, primary: true },
        ...editAction,
        { key: 'cancel', label: 'Cancel Session', icon: XCircle, danger: true },
      ];
  }
};

const formatPeso = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})}`;

const normalizeId = (value) => String(value ?? '').trim();

const uniqueBy = (rows, getKey) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const key = normalizeId(getKey(row));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeBookingItems = (items) => {
  const merged = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const name = String(item?.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const quantity = Math.max(Number(item?.quantity || 1), 1);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    merged.set(key, { ...item, name, quantity });
  });
  return Array.from(merged.values());
};

const normalizeBooking = (booking) => ({
  ...booking,
  items: mergeBookingItems(booking?.items),
  payments: uniqueBy(booking?.payments, payment => payment.id || `${payment.reference_number}-${payment.created_at}`),
});

const normalizeBookings = (rows) => uniqueBy(rows, row => row.id).map(normalizeBooking);

const normalizeServices = (rows) => uniqueBy(rows, row => row.id || row.name).map(service => ({
  ...service,
  packages: uniqueBy(service.packages, pkg => pkg.id || `${pkg.service}-${pkg.name}`),
}));

const createIdempotencyKey = (prefix) => {
  const random = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

const DOWN_PAYMENT_RATE = 0.5;
const calculateDownPayment = (price) => Number(price || 0) * DOWN_PAYMENT_RATE;
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidPhone = (value) => String(value || '').replace(/[^\d+]/g, '').replace(/^\+/, '').length >= 7;
const formatStatusLabel = (status) => ({
  CONFIRMED_DP: 'Confirmed - Down Payment Received',
  PENDING_VERIFICATION: 'Pending Verification',
}[status] || status);

const bookingStepHeaders = {
  service: { step: 'STEP 1 OF 4', title: 'CHOOSE SERVICE' },
  package: { step: 'STEP 2A OF 4', title: 'SELECT PACKAGE' },
  schedule: { step: 'STEP 2B OF 4', title: 'SCHEDULE DATE & TIME' },
  customer: { step: 'STEP 3 OF 4', title: 'CUSTOMER INFO' },
  review: { step: 'STEP 4 OF 4', title: 'REVIEW & PAYMENT' },
};

function BookingStepHeader({ step, title, description, className = '' }) {
  return (
    <div className={`text-left ${className}`}>
      <h2 className="text-xs md:text-sm font-black uppercase tracking-[0.16em] text-espresso leading-snug">
        {step} <span className="text-gold-dark">—</span> {title}
      </h2>
      {description && (
        <p className="mt-1 text-[11px] text-espresso/50 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

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
  const confirm = useStyledConfirm();
  const [activeTab, setActiveTab] = useState('book');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [points, setPoints] = useState(0);
  const [loyaltyTier, setLoyaltyTier] = useState('Bronze');
  const [profileSaving, setProfileSaving] = useState(false);

  const [selectedService, setSelectedService] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [notes, setNotes] = useState('');
  const [packageDetails, setPackageDetails] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [packageSlide, setPackageSlide] = useState(0);
  const [cardsPerSlide, setCardsPerSlide] = useState(2);
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [selectedBookingDetails, setSelectedBookingDetails] = useState(null);
  const [cancellingBookingId, setCancellingBookingId] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [, setEditMonth] = useState(getMonthValue());
  const [editDayAvailability, setEditDayAvailability] = useState(null);
  const [editSlotLoading, setEditSlotLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getDateInputValue());
  const [paymentTime, setPaymentTime] = useState(getTimeInputValue());
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [paymentReceiptPreview, setPaymentReceiptPreview] = useState('');
  const [paymentOcrLoading, setPaymentOcrLoading] = useState(false);
  const [paymentOcrResult, setPaymentOcrResult] = useState(null);
  const [paymentOcrWarnings, setPaymentOcrWarnings] = useState([]);
  const [paymentScanProgress, setPaymentScanProgress] = useState({
    status: 'idle',
    percent: 0,
    message: 'Upload a screenshot to scan payment details.',
    messages: [],
  });
  const [paymentReferenceStatus, setPaymentReferenceStatus] = useState({ checking: false, exists: false, message: '' });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [gcashQrMissing, setGcashQrMissing] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(getMonthValue());
  const [monthAvailability, setMonthAvailability] = useState({});
  const [dayAvailability, setDayAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [slotLoading, setSlotLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [galleryImages, setGalleryImages] = useState([]);
  const bookingSubmitInFlightRef = useRef(false);
  const bookingSubmitClickRef = useRef(0);
  const bookingIdempotencyKeyRef = useRef('');
  const paymentIdempotencyKeyRef = useRef('');

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

  useEffect(() => {
    return () => {
      if (paymentReceiptPreview) URL.revokeObjectURL(paymentReceiptPreview);
    };
  }, [paymentReceiptPreview]);

  const allPackages = uniqueBy(services.flatMap(service => (
    (service.packages || []).map(pkg => ({
      ...pkg,
      serviceName: service.name,
      serviceDescription: service.description,
      serviceDuration: service.duration_minutes,
      serviceImageUrl: service.image_url,
    }))
  )), pkg => pkg.id || `${pkg.service}-${pkg.name}`);

  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! I am your CAV AI assistant. How can I help you today? You can ask me about studio rooms, slots, packages, or coffee!' }
  ]);
  const [chatFaqPrompts, setChatFaqPrompts] = useState([]);
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
    if (currentStep === 3) {
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName.length >= 2 && isValidEmail(bookingEmail) && isValidPhone(phone);
    }
    if (currentStep === 4) return true;
    return false;
  }, [currentStep, selectedService, selectedPackage, selectedDate, selectedTime, firstName, lastName, bookingEmail, phone]);

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
    client.get('/api/chatbot/faqs/')
      .then(res => {
        const prompts = res.data.map(faq => faq.question).filter(Boolean).slice(0, 6);
        if (prompts.length) setChatFaqPrompts(prompts);
      })
      .catch(() => {});
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [servicesRes, bookingsRes, profileRes, galleryRes] = await Promise.all([
        client.get('/api/bookings/services/'),
        client.get('/api/bookings/'),
        client.get('/api/auth/profile/'),
        client.get('/api/gallery/images/').catch(() => ({ data: [] }))
      ]);
      const uniqueServices = normalizeServices(servicesRes.data);
      const uniqueBookings = normalizeBookings(bookingsRes.data);
      setServices(uniqueServices);
      setBookings(uniqueBookings);
      setGalleryImages(Array.isArray(galleryRes.data) ? galleryRes.data : []);
      const p = profileRes.data;
      setFirstName(p.first_name || '');
      setLastName(p.last_name || '');
      setBookingEmail(p.email || user?.email || '');
      setPhone(p.phone_number || '');
      setAddress(p.address || '');
      if (p.customer_profile) {
        setPoints(p.customer_profile.points || 0);
        setLoyaltyTier(p.customer_profile.loyalty_tier || 'Bronze');
      }
      const mockNotifications = [
        { id: 1, title: 'Welcome to CAV!', message: 'Enjoy 10% off on your first photo shoot session.', created_at: 'Just now', read: false }
      ];
      uniqueBookings.forEach(b => {
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
  }, [user?.email]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchDashboardData();
  }, [user, navigate, fetchDashboardData]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    if (profileSaving) return;
    const confirmed = await confirm({
      title: 'Update Profile',
      message: 'Save changes to your profile?',
      confirmLabel: 'Update Profile',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      setProfileSaving(true);
      await client.patch('/api/auth/profile/', {
        first_name: firstName, last_name: lastName,
        phone_number: phone, address
      });
      fetchDashboardData();
      alert('Profile updated successfully.');
    } catch {
      alert('Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePackageSelect = (pkg) => {
    const isSamePackage = selectedPackage?.id === pkg.id;
    setSelectedPackage(pkg);
    if (isSamePackage) return;
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

  const checkPaymentReferenceDuplicate = useCallback(async (referenceValue) => {
    const cleanReference = referenceValue.trim();
    if (!cleanReference) {
      setPaymentReferenceStatus({ checking: false, exists: false, message: '' });
      return false;
    }
    try {
      setPaymentReferenceStatus(current => ({ ...current, checking: true }));
      const res = await client.get('/api/bookings/payments/reference-check/', {
        params: { reference_number: cleanReference }
      });
      const exists = !!res.data.exists;
      setPaymentReferenceStatus({
        checking: false,
        exists,
        message: exists ? res.data.message || 'This GCash reference number has already been submitted.' : 'Reference number is available.',
      });
      return exists;
    } catch {
      setPaymentReferenceStatus({
        checking: false,
        exists: false,
        message: 'Could not check this reference number yet. Staff will still verify it.',
      });
      return false;
    }
  }, []);

  useEffect(() => {
    const cleanReference = paymentReference.trim();
    if (!cleanReference) {
      setPaymentReferenceStatus({ checking: false, exists: false, message: '' });
      return undefined;
    }
    const timer = window.setTimeout(() => {
      checkPaymentReferenceDuplicate(cleanReference);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [paymentReference, checkPaymentReferenceDuplicate]);

  const setPaymentScanStep = (status, percent, message) => {
    setPaymentScanProgress(current => ({
      status,
      percent,
      message,
      messages: current.messages.includes(message)
        ? current.messages
        : [...current.messages, message].slice(-5),
    }));
  };

  const handlePaymentReceiptUpload = async (file) => {
    setPaymentReceipt(file || null);
    setPaymentOcrResult(null);
    setPaymentOcrWarnings([]);
    setPaymentReferenceStatus({ checking: false, exists: false, message: '' });
    setPaymentScanProgress({
      status: file ? 'uploading' : 'idle',
      percent: file ? 5 : 0,
      message: file ? 'Uploading image' : 'Upload a screenshot to scan payment details.',
      messages: file ? ['Uploading image'] : [],
    });
    setPaymentReceiptPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return file ? URL.createObjectURL(file) : '';
    });
    if (!file) return;

    try {
      setPaymentOcrLoading(true);
      const ocrData = new FormData();
      ocrData.append('receipt', file);
      const res = await client.post('/api/bookings/payments/ocr/', ocrData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: progressEvent => {
          if (!progressEvent.total) return;
          const uploadPercent = Math.round((progressEvent.loaded * 30) / progressEvent.total);
          setPaymentScanProgress(current => ({
            ...current,
            status: progressEvent.loaded >= progressEvent.total ? 'reading' : 'uploading',
            percent: Math.min(35, Math.max(current.percent, 5 + uploadPercent)),
            message: progressEvent.loaded >= progressEvent.total ? 'Reading payment details' : 'Uploading image',
            messages: progressEvent.loaded >= progressEvent.total && !current.messages.includes('Reading payment details')
              ? [...current.messages, 'Reading payment details'].slice(-5)
              : current.messages,
          }));
        },
      });
      setPaymentScanStep('reading', 55, 'Reading payment details');
      const fields = res.data.fields || {};
      const nextReference = fields.reference_number?.value || '';
      setPaymentScanStep('validating', 72, 'Validating reference number');
      if (nextReference) setPaymentReference(nextReference);
      setPaymentScanStep('autofilling', 88, 'Autofilling fields');
      if (fields.amount?.value) setPaymentAmount(fields.amount.value);
      if (fields.payment_date?.value) setPaymentDate(fields.payment_date.value);
      if (fields.payment_time?.value) setPaymentTime(fields.payment_time.value);
      setPaymentOcrResult(res.data);
      setPaymentOcrWarnings(res.data.warnings || []);
      if (res.data.duplicate_reference) {
        setPaymentReferenceStatus({
          checking: false,
          exists: true,
          message: 'This GCash reference number has already been submitted.',
        });
      }
      const readableFields = Object.values(fields).filter(field => field?.value).length;
      if (res.data.duplicate_reference) {
        setPaymentScanStep('error', 100, 'Reference already submitted');
      } else if (!res.data.ocr_available || readableFields === 0) {
        setPaymentScanStep('error', 100, 'Scan failed');
      } else {
        setPaymentScanStep('success', 100, 'Scan complete');
      }
    } catch {
      setPaymentOcrWarnings(['Could not scan this screenshot. Please enter the payment details manually.']);
      setPaymentScanStep('error', 100, 'Scan failed');
    } finally {
      setPaymentOcrLoading(false);
    }
  };

  const getPackageById = useCallback((packageId) => (
    allPackages.find(pkg => String(pkg.id) === String(packageId))
  ), [allPackages]);

  const openEditBooking = (booking) => {
    if (!booking.can_edit) {
      alert(booking.edit_locked_reason || 'This booking can no longer be edited.');
      return;
    }
    const customer = booking.customer || {};
    const month = booking.scheduled_date ? booking.scheduled_date.slice(0, 7) : getMonthValue();
    setEditingBooking(booking);
    setEditForm({
      package: String(booking.package || booking.package_details?.id || ''),
      scheduled_date: booking.scheduled_date || '',
      scheduled_time: booking.scheduled_time || '',
      notes: booking.notes || '',
      first_name: customer.first_name || firstName || '',
      last_name: customer.last_name || lastName || '',
      email: customer.email || user?.email || '',
      phone_number: customer.phone_number || phone || '',
      address: customer.address || address || '',
      change_reason: 'Customer updated booking details',
    });
    setEditMonth(month);
    setEditDayAvailability(null);
    setEditError('');
  };

  const closeEditBooking = (force = false) => {
    if (editSaving && !force) return;
    setEditingBooking(null);
    setEditForm(null);
    setEditDayAvailability(null);
    setEditError('');
    setEditConfirmOpen(false);
  };

  const fetchEditDayAvailability = useCallback(async (dateValue = editForm?.scheduled_date, packageId = editForm?.package) => {
    if (!editingBooking || !packageId || !dateValue) return null;
    try {
      setEditSlotLoading(true);
      setEditError('');
      const res = await client.get('/api/bookings/availability/', {
        params: { package: packageId, date: dateValue, exclude_booking: editingBooking.id }
      });
      setEditDayAvailability(res.data);
      setEditForm(current => {
        if (!current) return current;
        const currentSlotAvailable = res.data.slots?.some(slot => slot.time === current.scheduled_time && slot.available);
        return current.scheduled_time && !currentSlotAvailable ? { ...current, scheduled_time: '' } : current;
      });
      return res.data;
    } catch {
      setEditError('Could not load available time slots.');
      return null;
    } finally {
      setEditSlotLoading(false);
    }
  }, [editForm?.package, editForm?.scheduled_date, editingBooking]);

  useEffect(() => {
    if (editingBooking && editForm?.package && editForm?.scheduled_date) {
      fetchEditDayAvailability(editForm.scheduled_date, editForm.package);
    }
  }, [editingBooking, editForm?.package, editForm?.scheduled_date, fetchEditDayAvailability]);

  const handleEditPackageChange = (packageId) => {
    setEditForm(current => current ? {
      ...current,
      package: packageId,
      scheduled_time: '',
    } : current);
    setEditDayAvailability(null);
  };

  const handleEditDateChange = (dateValue) => {
    setEditMonth(dateValue ? dateValue.slice(0, 7) : getMonthValue());
    setEditForm(current => current ? {
      ...current,
      scheduled_date: dateValue,
      scheduled_time: '',
    } : current);
    setEditDayAvailability(null);
  };

  const submitEditBooking = async () => {
    if (!editingBooking || !editForm || editSaving) return;
    if (!editForm.package || !editForm.scheduled_date || !editForm.scheduled_time) {
      setEditError('Please select a package, date, and available time slot.');
      return;
    }

    const confirmed = await confirm({
      title: 'Update Booking',
      message: 'Save changes to this booking?',
      confirmLabel: 'Update Booking',
      type: 'warning',
    });
    if (!confirmed) return;

    try {
      setEditSaving(true);
      setEditError('');
      const latestAvailability = await fetchEditDayAvailability(editForm.scheduled_date, editForm.package);
      const selectedSlot = latestAvailability?.slots?.find(slot => slot.time === editForm.scheduled_time);
      if (!selectedSlot?.available) {
        setEditError('This schedule is no longer available. Please choose another time slot.');
        return;
      }

      const res = await client.patch(`/api/bookings/${editingBooking.id}/`, {
        package: Number(editForm.package),
        scheduled_date: editForm.scheduled_date,
        scheduled_time: editForm.scheduled_time,
        notes: editForm.notes,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        email: editForm.email,
        phone_number: editForm.phone_number,
        address: editForm.address,
        change_reason: editForm.change_reason,
      });

      const normalizedBooking = normalizeBooking(res.data);
      setBookings(current => normalizeBookings(current.map(item => item.id === editingBooking.id ? normalizedBooking : item)));
      setSelectedBookingDetails(current => current?.id === editingBooking.id ? normalizedBooking : current);
      setFirstName(editForm.first_name);
      setLastName(editForm.last_name);
      setBookingEmail(editForm.email);
      setPhone(editForm.phone_number);
      setAddress(editForm.address);
      closeEditBooking(true);
      alert('Booking updated successfully.');
    } catch (err) {
      const errorData = err.response?.data || {};
      setEditError(errorData.scheduled_time || errorData.detail || 'Failed to update booking.');
    } finally {
      setEditSaving(false);
      setEditConfirmOpen(false);
    }
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
    const now = Date.now();
    if (bookingSubmitInFlightRef.current || paymentSubmitting || now - bookingSubmitClickRef.current < 900) {
      return;
    }
    bookingSubmitClickRef.current = now;

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
    if (paymentReferenceStatus.exists) {
      alert('This GCash reference number has already been submitted. Please upload the correct receipt or enter a different reference number.');
      return;
    }
    bookingSubmitInFlightRef.current = true;
    const confirmed = await confirm({
      title: 'Submit Booking',
      message: `Reserve ${selectedPackage.name} on ${selectedDate} at ${selectedTime}?`,
      confirmLabel: 'Submit Booking',
      type: 'success',
    });
    if (!confirmed) {
      bookingSubmitInFlightRef.current = false;
      return;
    }
    try {
      setPaymentSubmitting(true);
      if (!bookingIdempotencyKeyRef.current) {
        bookingIdempotencyKeyRef.current = createIdempotencyKey('booking');
      }
      if (!paymentIdempotencyKeyRef.current) {
        paymentIdempotencyKeyRef.current = createIdempotencyKey('booking-payment');
      }
      const duplicateReference = await checkPaymentReferenceDuplicate(paymentReference);
      if (duplicateReference) {
        alert('This GCash reference number has already been submitted. Please upload the correct receipt or enter a different reference number.');
        setPaymentSubmitting(false);
        return;
      }
      const latestAvailability = await fetchDayAvailability(selectedDate);
      const latestSlot = latestAvailability?.slots?.find(slot => slot.time === selectedTime);
      if (!latestSlot?.available) {
        alert('This schedule is no longer available. Please choose another date or time slot.');
        setPaymentSubmitting(false);
        return;
      }
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName.length < 2 || !isValidEmail(bookingEmail) || !isValidPhone(phone)) {
        alert('Please enter your full name, a valid email address, and a valid contact number.');
        setPaymentSubmitting(false);
        return;
      }
      const bookingRes = await client.post('/api/bookings/', {
        package: selectedPackage.id, scheduled_date: selectedDate,
        scheduled_time: selectedTime, notes,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: bookingEmail.trim(),
        phone_number: phone.trim(),
        address: address.trim(),
        idempotency_key: bookingIdempotencyKeyRef.current,
      }, {
        headers: { 'Idempotency-Key': bookingIdempotencyKeyRef.current },
      });
      const paidAt = new Date(`${paymentDate}T${paymentTime}:00`);
      const paymentData = new FormData();
      paymentData.append('booking', bookingRes.data.id);
      paymentData.append('reference_number', paymentReference.trim());
      paymentData.append('amount', paidAmount.toFixed(2));
      paymentData.append('paid_at', paidAt.toISOString());
      paymentData.append('receipt', paymentReceipt);
      paymentData.append('idempotency_key', paymentIdempotencyKeyRef.current);
      const paymentRes = await client.post('/api/bookings/payments/', paymentData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Idempotency-Key': paymentIdempotencyKeyRef.current,
        }
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
      setSelectedDate(''); setSelectedTime(''); setNotes('');
      setPaymentReference('');
      setPaymentAmount('');
      setPaymentDate(getDateInputValue());
      setPaymentTime(getTimeInputValue());
      setPaymentReceipt(null);
      setPaymentReceiptPreview('');
      setPaymentOcrResult(null);
      setPaymentOcrWarnings([]);
      setPaymentScanProgress({
        status: 'idle',
        percent: 0,
        message: 'Upload a screenshot to scan payment details.',
        messages: [],
      });
      setPaymentReferenceStatus({ checking: false, exists: false, message: '' });
      bookingIdempotencyKeyRef.current = '';
      paymentIdempotencyKeyRef.current = '';
      setCurrentStep(1);
      fetchDashboardData();
      setActiveTab('history');
      alert('Booking submitted successfully.');
    } catch (err) {
      const errorData = err.response?.data || {};
      alert(errorData.scheduled_time || errorData.amount || errorData.detail || 'Failed to submit booking payment.');
      if (err.response?.status === 409) {
        fetchDayAvailability(selectedDate);
        fetchMonthAvailability();
      }
    } finally {
      bookingSubmitInFlightRef.current = false;
      setPaymentSubmitting(false);
    }
  };

  const handleBookingAction = async (booking, action) => {
    if (action.key === 'details') {
      setSelectedBookingDetails(booking);
      return;
    }

    if (action.key === 'edit') {
      openEditBooking(booking);
      return;
    }

    if (action.key === 'receipt') {
      const receiptUrl = booking.payments?.find(payment => payment.receipt_url)?.receipt_url;
      if (receiptUrl) window.open(receiptUrl, '_blank', 'noopener,noreferrer');
      else setSelectedBookingDetails(booking);
      return;
    }

    if (action.key !== 'cancel') return;
    if (cancellingBookingId === booking.id) return;
    const confirmed = await confirm({
      title: 'Cancel Booking',
      message: `Cancel booking for ${booking.package_details?.name || 'this package'}?`,
      confirmLabel: 'Cancel Booking',
      type: 'error',
    });
    if (!confirmed) return;

    try {
      setCancellingBookingId(booking.id);
      const res = await client.patch(`/api/bookings/${booking.id}/`, { status: 'CANCELLED' });
      const normalizedBooking = normalizeBooking(res.data);
      setBookings(current => normalizeBookings(current.map(item => item.id === booking.id ? normalizedBooking : item)));
      setSelectedBookingDetails(current => current?.id === booking.id ? normalizedBooking : current);
      alert('Booking cancelled successfully.');
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to cancel booking.');
    } finally {
      setCancellingBookingId(null);
    }
  };

  const sendChatMessage = useCallback(async (message) => {
    const msg = message.trim();
    if (!msg || chatLoading) return;
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
  }, [chatLoading]);

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    await sendChatMessage(chatInput);
  };

  const handleLogout = useCallback(() => {
    alert('Signed out successfully.');
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  if (loading) return <CustomerSkeleton />;

  const navItems = [
    { key: 'book', label: 'Book a Session', icon: Plus, active: activeTab === 'book', onClick: () => setActiveTab('book') },
    { key: 'history', label: 'Booking History', icon: Clock, active: activeTab === 'history', onClick: () => setActiveTab('history') },
    { key: 'profile', label: 'My Profile', icon: User, active: activeTab === 'profile', onClick: () => setActiveTab('profile') },
    { key: 'notifications', label: 'Notifications', icon: Bell, active: activeTab === 'notifications', onClick: () => setActiveTab('notifications'),
      badge: notifications.length },
  ];

  const pageTitles = { book: 'Book a Session', history: 'Booking History', profile: 'My Profile', notifications: 'Notifications' };

  const customerFullName = `${firstName} ${lastName}`.trim();
  const handleCustomerFullNameChange = (value) => {
    const cleanValue = value.replace(/\s+/g, ' ').trimStart();
    const parts = cleanValue.trim().split(' ').filter(Boolean);
    setFirstName(parts[0] || '');
    setLastName(parts.slice(1).join(' '));
  };
  const totalCart = selectedPackage ? parseFloat(selectedPackage.price) : 0;
  const requiredDownPayment = selectedPackage ? calculateDownPayment(selectedPackage.price) : 0;
  const calendarDays = getCalendarDays(calendarMonth);
  const selectedDaySlots = dayAvailability?.date === selectedDate ? (dayAvailability.slots || []) : [];
  const availableSlotsCount = selectedDaySlots.filter(slot => slot.available).length;
  const editSelectedPackage = editForm ? getPackageById(editForm.package) : null;
  const editAvailableSlots = editDayAvailability && editDayAvailability.date === editForm?.scheduled_date ? (editDayAvailability.slots || []) : [];
  const editAddonsTotal = editingBooking?.items?.reduce((acc, item) => acc + (parseFloat(item.price) * item.quantity), 0) || 0;
  const editTotal = editSelectedPackage ? parseFloat(editSelectedPackage.price || 0) + editAddonsTotal : editAddonsTotal;
  const detailPackage = packageDetails?.package || null;
  const detailService = packageDetails?.service || null;
  const detailInclusions = splitPackageText(detailPackage?.inclusions);
  const detailOutputs = getPackagePhotoOutputs(detailPackage);
  const detailGalleryCategory = getPackageGalleryCategory(detailPackage, detailService);
  const detailGallerySource = galleryImages.length ? galleryImages : packageSampleFallbacks;
  const detailGalleryImages = detailGallerySource
    .filter(item => item.image_url && item.category === detailGalleryCategory)
    .slice(0, 4);
  const visibleDetailGalleryImages = detailGalleryImages.length
    ? detailGalleryImages
    : packageSampleFallbacks.filter(item => item.category === detailGalleryCategory).slice(0, 4);
  const hasPackageOptions = selectedService?.packages?.length > 0;
  const isStep2PackageComplete = currentStep > 2 || (currentStep === 2 && (!hasPackageOptions || !!selectedPackage));
  const isStep2ScheduleActive = currentStep === 2 && isStep2PackageComplete;
  const isStep2ScheduleComplete = currentStep > 2 || (
    currentStep === 2 &&
    !!selectedDate &&
    !!selectedTime &&
    (!hasPackageOptions || !!selectedPackage)
  );
  const activeBookingStepHeader = currentStep === 1
    ? bookingStepHeaders.service
    : currentStep === 2
    ? isStep2ScheduleActive
      ? bookingStepHeaders.schedule
      : bookingStepHeaders.package
    : currentStep === 3
    ? bookingStepHeaders.customer
    : bookingStepHeaders.review;
  const currentStepTitle = `${activeBookingStepHeader.step} — ${activeBookingStepHeader.title}`;
  const bookingProgressValue = currentStep === 2
    ? isStep2ScheduleComplete
      ? 2.6
      : isStep2ScheduleActive
      ? 2.35
      : 2
    : currentStep;
  const bookingProgressItems = [
    { step: 1, label: 'Service' },
    {
      step: 2,
      label: 'Package & Schedule',
      substeps: [
        {
          key: '2a',
          label: '2A Select Package',
          active: currentStep === 2 && !isStep2ScheduleActive,
          complete: currentStep > 2 || (currentStep === 2 && isStep2PackageComplete),
        },
        {
          key: '2b',
          label: '2B Schedule Date & Time',
          active: isStep2ScheduleActive,
          complete: isStep2ScheduleComplete,
        },
      ],
    },
    { step: 3, label: 'Customer Info' },
    { step: 4, label: 'Review' },
  ];
  const getBookingTotal = (booking) => (
    parseFloat(booking.package_details?.price || 0) +
    (booking.items?.reduce((acc, item) => acc + (parseFloat(item.price) * item.quantity), 0) || 0)
  );
  const getBookingCustomerName = (booking) => {
    const customer = booking?.customer || {};
    return `${customer.first_name || firstName || ''} ${customer.last_name || lastName || ''}`.trim()
      || customer.username
      || user?.username
      || 'Customer';
  };
  const getBookingContact = (booking) => {
    const customer = booking?.customer || {};
    return {
      phone: customer.phone_number || phone || 'No phone provided',
      email: customer.email || user?.email || 'No email provided',
      address: customer.address || address || '',
    };
  };

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
                      <BookingStepHeader {...activeBookingStepHeader} className="mb-3" />

                      {/* Mobile progress indicator */}
                      <div className="md:hidden flex flex-col gap-2" aria-label={currentStepTitle}>
                        <div className="w-full bg-cream rounded-full h-1.5">
                          <div 
                            className="bg-gold h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${(bookingProgressValue / 4) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Desktop progress indicator */}
                      <div className="hidden md:flex justify-between items-center relative px-2">
                        <div className="absolute top-4 left-6 right-6 h-0.5 bg-cream z-0" />
                        <div 
                          className="absolute top-4 left-6 h-0.5 bg-gold transition-all duration-500 z-0"
                          style={{ width: `${((bookingProgressValue - 1) / 3) * 88}%` }}
                        />
                        {bookingProgressItems.map((s) => {
                          const isActive = currentStep === s.step;
                          const isComplete = currentStep > s.step;
                          return (
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
                              className="relative z-10 flex min-w-[132px] flex-col items-center gap-1.5 focus:outline-none"
                              aria-current={isActive ? 'step' : undefined}
                            >
                              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${
                                isActive
                                  ? 'bg-espresso text-gold border-gold scale-105 shadow-sm'
                                  : isComplete
                                  ? 'bg-gold text-cream border-gold'
                                  : 'bg-white text-espresso/40 border-cream-dark'
                              }`}>
                                {isComplete ? <Check className="w-4 h-4" /> : s.step}
                              </span>
                              <span className={`text-[9px] uppercase font-extrabold tracking-widest transition-all duration-300 ${
                                isActive ? 'text-espresso' : isComplete ? 'text-gold-dark' : 'text-espresso/40'
                              }`}>
                                {s.label}
                              </span>
                              {s.substeps && (
                                <div className="flex flex-wrap justify-center gap-1.5">
                                  {s.substeps.map(substep => (
                                    <span
                                      key={substep.key}
                                      className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider transition-all duration-300 ${
                                        substep.active
                                          ? 'border-gold bg-gold/15 text-espresso shadow-sm'
                                          : substep.complete
                                          ? 'border-gold bg-gold text-cream'
                                          : 'border-espresso/10 bg-white text-espresso/35'
                                      }`}
                                    >
                                      {substep.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </button>
                          );
                        })}
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
                                <BookingStepHeader {...bookingStepHeaders.package} />
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
                                                    <div
                                                      className={`w-full rounded-2xl border-2 text-left flex flex-col transition-all duration-300 h-full group/card relative ${
                                                        isSelected 
                                                          ? 'border-gold bg-gold/[0.04] shadow-md scale-[1.01]' 
                                                          : 'border-espresso/10 hover:border-espresso/30 bg-white hover:shadow-sm'
                                                      }`}
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

                                                        {/* Bottom row: Price and actions */}
                                                        <div className="space-y-2 pt-2 mt-auto border-t border-espresso/5 shrink-0">
                                                          <div className="flex justify-between items-center">
                                                            <span className="text-gold font-extrabold text-xs">₱{pkg.price}</span>
                                                            {!isSelected && (
                                                              <span className="text-[9px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider transition-all duration-300 bg-espresso/5 text-espresso/50 group-hover/card:bg-espresso/10">
                                                                Available
                                                              </span>
                                                            )}
                                                          </div>
                                                          <div className="grid grid-cols-1 gap-2">
                                                            <button
                                                              type="button"
                                                              onClick={() => handlePackageSelect(pkg)}
                                                              className={`w-full rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all duration-300 ${
                                                                isSelected
                                                                  ? 'bg-gold text-cream shadow-sm'
                                                                  : 'bg-espresso text-cream hover:bg-espresso-light'
                                                              }`}
                                                              aria-pressed={isSelected}
                                                              aria-label={`Select ${pkg.name} package`}
                                                            >
                                                              {isSelected ? 'Selected' : 'Select Package'}
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => setPackageDetails({ package: pkg, service: selectedService })}
                                                              className="w-full rounded-xl border border-espresso/10 bg-white px-3 py-2 text-[10px] font-black text-espresso/65 transition-all duration-300 hover:border-gold/40 hover:bg-gold/10 hover:text-espresso"
                                                              aria-label={`View what is included in ${pkg.name}`}
                                                            >
                                                              What's in this package?
                                                            </button>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    </div>
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
                            <BookingStepHeader {...bookingStepHeaders.schedule} />
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

                        {/* Step 3: Customer Information & Notes */}
                        <div className="w-[25%] shrink-0 h-full overflow-y-auto pr-1 pb-4 flex flex-col gap-4">
                          <p className="text-[11px] text-espresso/50">Confirm the details staff will use for this booking.</p>

                          <div className="rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm space-y-3">
                            <Input
                              label="Full Name"
                              required
                              value={customerFullName}
                              onChange={(e) => handleCustomerFullNameChange(e.target.value)}
                              placeholder="Juan Dela Cruz"
                            />
                            {customerFullName && customerFullName.length < 2 && (
                              <p className="text-[11px] font-bold text-red-600">Please enter your full name.</p>
                            )}

                            <Input
                              label="Email Address"
                              type="email"
                              required
                              value={bookingEmail}
                              onChange={(e) => setBookingEmail(e.target.value)}
                              placeholder="customer@example.com"
                            />
                            {bookingEmail && !isValidEmail(bookingEmail) && (
                              <p className="text-[11px] font-bold text-red-600">Enter a valid email address.</p>
                            )}

                            <Input
                              label="Contact Number"
                              type="tel"
                              required
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="09XXXXXXXXX"
                            />
                            {phone && !isValidPhone(phone) && (
                              <p className="text-[11px] font-bold text-red-600">Enter a valid contact number.</p>
                            )}

                            <Input
                              label="Address"
                              value={address}
                              onChange={(e) => setAddress(e.target.value)}
                              placeholder="City, province, or full address"
                            />

                            <div className="rounded-xl bg-cream/70 border border-espresso/5 p-3 text-[11px] text-espresso/55 leading-relaxed">
                              These details are pre-filled from your account when available. You can edit them here before submitting this booking.
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
                          <p className="text-[11px] text-espresso/50">Verify details before submitting your slot reservation request.</p>

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

                            <div className="border-b border-espresso/5 pb-2">
                              <p className="text-[9px] uppercase tracking-wider text-espresso/40 mb-1">Customer Information</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                <div>
                                  <span className="text-espresso/45">Name</span>
                                  <p className="font-bold text-espresso">{customerFullName || 'Not provided'}</p>
                                </div>
                                <div>
                                  <span className="text-espresso/45">Phone</span>
                                  <p className="font-bold text-espresso">{phone || 'Not provided'}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <span className="text-espresso/45">Email</span>
                                  <p className="font-bold text-espresso break-all">{bookingEmail || 'Not provided'}</p>
                                </div>
                              </div>
                            </div>

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
                                  Pay through the business GCash QR, then upload the receipt screenshot. OCR will autofill readable details, but staff must still verify the merchant record before confirming the booking.
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
                              {(paymentReferenceStatus.message || paymentOcrWarnings.length > 0) && (
                                <div className={`rounded-2xl border p-3 text-[11px] font-semibold leading-relaxed ${
                                  paymentReferenceStatus.exists
                                    ? 'border-red-100 bg-red-50 text-red-700'
                                    : paymentOcrWarnings.length > 0
                                    ? 'border-amber-100 bg-amber-50 text-amber-800'
                                    : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                }`}>
                                  {paymentReferenceStatus.message && (
                                    <p>{paymentReferenceStatus.checking ? 'Checking reference number...' : paymentReferenceStatus.message}</p>
                                  )}
                                  {paymentOcrWarnings.map((warning, index) => (
                                    <p key={`${warning}-${index}`}>{warning}</p>
                                  ))}
                                </div>
                              )}

                              <div>
                                <span className="text-xs font-bold uppercase tracking-[0.16em] block text-espresso/70 mb-2">GCash Screenshot OCR</span>
                                <div className="rounded-2xl border border-dashed border-espresso/15 bg-cream/35 p-3 grid grid-cols-1 sm:grid-cols-[112px_1fr] gap-3">
                                  <div className="h-28 rounded-xl bg-white text-gold-dark flex items-center justify-center border border-espresso/5 overflow-hidden">
                                    {paymentReceiptPreview ? (
                                      <img src={paymentReceiptPreview} alt="GCash receipt preview" className="h-full w-full object-cover" />
                                    ) : (
                                      <Upload className="w-5 h-5" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={e => handlePaymentReceiptUpload(e.target.files?.[0] || null)}
                                      className="block w-full text-xs text-espresso file:mr-3 file:rounded-xl file:border-0 file:bg-espresso file:px-3 file:py-2 file:text-xs file:font-bold file:text-gold"
                                      required
                                    />
                                    <p className="text-[10px] text-espresso/45 mt-1 truncate">
                                      {paymentReceipt ? paymentReceipt.name : 'Upload a clear GCash receipt screenshot.'}
                                    </p>
                                    <div className={`mt-2 rounded-xl border p-2 text-[10px] leading-relaxed ${
                                      paymentScanProgress.status === 'success'
                                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                        : paymentScanProgress.status === 'error'
                                        ? 'border-red-100 bg-red-50 text-red-700'
                                        : paymentOcrLoading
                                        ? 'border-gold/20 bg-gold/10 text-espresso'
                                        : 'border-espresso/5 bg-white/75 text-espresso/55'
                                    }`}>
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="font-black">
                                          {paymentScanProgress.message}
                                        </p>
                                        {paymentReceipt && (paymentScanProgress.status === 'error' || paymentOcrWarnings.length > 0) && (
                                          <button
                                            type="button"
                                            onClick={() => handlePaymentReceiptUpload(paymentReceipt)}
                                            disabled={paymentOcrLoading}
                                            className="shrink-0 rounded-lg border border-current/20 px-2 py-1 text-[9px] font-black uppercase tracking-wider transition-all hover:bg-white/60 disabled:opacity-50"
                                          >
                                            Retry Scan
                                          </button>
                                        )}
                                      </div>
                                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80 border border-current/10">
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${
                                            paymentScanProgress.status === 'success'
                                              ? 'bg-emerald-500'
                                              : paymentScanProgress.status === 'error'
                                              ? 'bg-red-500'
                                              : 'bg-gold'
                                          }`}
                                          style={{ width: `${paymentScanProgress.percent}%` }}
                                        />
                                      </div>
                                      {paymentScanProgress.messages.length > 0 ? (
                                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                                          {paymentScanProgress.messages.map((message, index) => (
                                            <span key={`${message}-${index}`} className="font-semibold">
                                              {message}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="mt-2">OCR will try to fill the reference number, amount, payment date, and payment time automatically.</p>
                                      )}
                                      {paymentOcrResult && (
                                        <div className="mt-2 border-t border-current/10 pt-2">
                                          <p className="font-black text-espresso">Review and correct any field before submitting.</p>
                                          <div className="mt-1 grid grid-cols-2 gap-1">
                                            {Object.entries(paymentOcrResult.fields || {}).map(([key, field]) => (
                                              <span key={key} className={field.confidence < 0.35 ? 'font-bold text-amber-700' : ''}>
                                                {key.replace(/_/g, ' ')}: {Math.round((field.confidence || 0) * 100)}%
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom: Navigation controls */}
                    <div className="flex justify-between items-center border-t border-espresso/5 pt-4 mt-auto shrink-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setCurrentStep(prev => prev - 1)}
                          disabled={currentStep === 1}
                          className="px-5 text-xs"
                        >
                          Back to Details
                        </Button>
                      </div>
                      
                      {currentStep < 4 ? (
                        <Button 
                          variant="gold" 
                          size="sm" 
                          onClick={() => setCurrentStep(prev => prev + 1)}
                          disabled={!canGoNext()}
                          className="px-6 text-xs"
                        >
                          Continue Booking
                        </Button>
                      ) : (
                        <Button 
                          variant="gold" 
                          size="sm" 
                          onClick={handleBookingSubmit}
                          loading={paymentSubmitting}
                          disabled={paymentSubmitting || paymentReferenceStatus.exists}
                          className="px-6 text-xs bg-emerald-600 border-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {paymentSubmitting ? 'Securing Your Slot...' : 'Reserve Your Session'}
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

                        {customerFullName && (
                          <div className="space-y-2 pt-2 border-t border-espresso/5">
                            <p className="text-[10px] uppercase text-espresso/50 font-bold">Customer</p>
                            <div className="rounded-xl bg-cream/70 border border-espresso/5 p-3 text-[11px] text-espresso/70 space-y-1">
                              <p className="font-bold text-espresso">{customerFullName}</p>
                              <p>{phone || 'No contact number'}</p>
                              <p className="break-all">{bookingEmail || 'No email address'}</p>
                            </div>
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
                          const actions = getBookingActions(b);
                          const contact = getBookingContact(b);
                          return (
                            <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,1.1fr)_minmax(300px,1fr)_240px] gap-4 md:gap-5 items-stretch">
                              <div className="flex gap-4 min-w-0">
                                <div className="w-20 h-20 md:w-24 md:h-24 rounded-[18px] bg-gradient-to-br from-cream-dark to-white border border-espresso/[0.06] shadow-inner overflow-hidden shrink-0 flex items-center justify-center">
                                  <Camera className="w-8 h-8 text-gold-dark/70" />
                                </div>
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex items-start gap-2 flex-wrap">
                                    <h3 className="text-base md:text-lg font-black text-espresso leading-snug">{getBookingCustomerName(b)}</h3>
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
                                  <div className="rounded-2xl border border-espresso/[0.07] bg-white/85 p-4 md:p-5 shadow-[0_12px_28px_rgba(46,26,17,0.06)]">
                                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,max-content)] items-center gap-x-4 gap-y-3">
                                      <div className="flex min-w-0 items-center gap-4">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold-dark">
                                          <Sparkles className="h-4 w-4" />
                                        </span>
                                        <div className="min-w-0">
                                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-espresso/38">Selected Package</p>
                                          <p className="truncate text-sm font-black leading-5 text-espresso md:text-base">
                                            {b.package_details?.name || 'Photography Package'}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex min-w-0 items-center justify-end gap-3 text-right">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cream text-gold-dark">
                                          <Phone className="h-4 w-4" />
                                        </span>
                                        <span className="max-w-[34vw] truncate whitespace-nowrap text-xs font-bold text-espresso/68 sm:max-w-[180px]">
                                          {contact.phone}
                                        </span>
                                      </div>
                                      <div className="col-span-2 flex min-w-0 items-center gap-4 border-t border-espresso/[0.06] pt-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cream text-gold-dark">
                                          <Mail className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0 truncate whitespace-nowrap text-xs font-semibold text-espresso/60">
                                          {contact.email}
                                        </span>
                                      </div>
                                    </div>
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
                                        onClick={() => handleBookingAction(b, action)}
                                        disabled={action.key === 'cancel' && cancellingBookingId === b.id}
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
                                        {action.key === 'cancel' && cancellingBookingId === b.id ? 'Cancelling Session...' : action.label}
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
                        <Input label="First Name" value={firstName} onChange={e => setFirstName(e.target.value)} disabled={profileSaving} />
                        <Input label="Last Name" value={lastName} onChange={e => setLastName(e.target.value)} disabled={profileSaving} />
                      </div>
                      <Input label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={profileSaving} />
                      <Textarea label="Address" value={address} onChange={e => setAddress(e.target.value)} rows={3} disabled={profileSaving} />
                      <div className="flex items-center gap-3 pt-2">
                        <Button type="submit" variant="primary" loading={profileSaving} disabled={profileSaving}>Update My Profile</Button>
                        <Button type="button" variant="outline" size="sm" onClick={fetchDashboardData} disabled={profileSaving}>Restore Saved Info</Button>
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
          open={!!packageDetails}
          onClose={() => setPackageDetails(null)}
          title={detailPackage ? detailPackage.name : 'Package Details'}
          size="5xl"
          bodyClassName="!max-h-none !overflow-visible !p-4 md:!p-5"
        >
          {detailPackage && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] gap-4">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-espresso/5 bg-cream/60 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-espresso/40">
                          {detailService?.name || detailPackage.serviceName || 'Photo Session'}
                        </p>
                        <p className="mt-1 text-sm leading-snug text-espresso/68">
                          {detailPackage.description || detailService?.description || detailPackage.serviceDescription || 'A guided CAV photo session prepared by the studio team.'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gold/20 bg-gold/10 px-4 py-2 text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-espresso/45">Price</p>
                        <p className="text-xl font-black text-espresso">{formatPeso(detailPackage.price)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-espresso/5 bg-white p-3.5 shadow-sm">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-espresso/40">What's Included</p>
                    {detailInclusions.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {detailInclusions.map((item, idx) => (
                          <div key={`${item}-${idx}`} className="flex items-start gap-2 rounded-xl bg-cream/55 px-2.5 py-1.5 text-[11px] leading-snug text-espresso/70">
                            <Check className="w-3.5 h-3.5 text-gold shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-espresso/50">Package inclusions will be confirmed by staff.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-espresso/5 bg-white p-3.5 shadow-sm">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-espresso/40">Photo Outputs</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {detailOutputs.map((item, idx) => (
                        <div key={`${item}-${idx}`} className="flex items-center gap-2 rounded-xl bg-cream/45 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-espresso/70">
                          <Camera className="w-3.5 h-3.5 text-gold shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-espresso/5 bg-white p-3.5 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-espresso/40">Sample Gallery</p>
                    <span className="rounded-full bg-cream px-2.5 py-1 text-[10px] font-black text-espresso/55">
                      {detailGalleryCategory === 'EVENTS' ? 'Events' : 'Studio'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {visibleDetailGalleryImages.map((image) => (
                      <figure key={image.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-cream">
                        <img
                          src={image.image_url}
                          alt={image.alt_text || image.title || detailPackage.name}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-espresso-dark/80 to-transparent p-2 text-[9px] font-bold text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          {image.title || detailPackage.name}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="gold"
                  className="flex-1"
                  onClick={() => {
                    handlePackageSelect(detailPackage);
                    setPackageDetails(null);
                  }}
                >
                  Choose This Package
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setPackageDetails(null)}>
                  Keep Exploring Packages
                </Button>
              </div>
            </div>
          )}
        </Modal>

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
              View My Booking
            </Button>
          </div>
        </Modal>

        <Modal
          open={!!editingBooking}
          onClose={closeEditBooking}
          title="Edit Booking"
          size="3xl"
        >
          {editingBooking && editForm && (
            <div className="space-y-5">
              {!editingBooking.can_edit && (
                <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm font-semibold text-red-700">
                  {editingBooking.edit_locked_reason || 'This booking is locked.'}
                </div>
              )}

              <div className="rounded-2xl bg-cream/70 border border-espresso/5 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="font-black uppercase tracking-wider text-espresso/45">Current Package</p>
                  <p className="font-bold text-espresso mt-1">{editingBooking.package_details?.name}</p>
                </div>
                <div>
                  <p className="font-black uppercase tracking-wider text-espresso/45">Current Schedule</p>
                  <p className="font-bold text-espresso mt-1">{editingBooking.scheduled_date} at {editingBooking.scheduled_time}</p>
                </div>
                <div>
                  <p className="font-black uppercase tracking-wider text-espresso/45">Updated Total</p>
                  <p className="font-black text-gold-dark mt-1">{formatPeso(editTotal)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] block text-espresso/70">Selected Package</span>
                    <select
                      value={editForm.package}
                      onChange={(e) => handleEditPackageChange(e.target.value)}
                      disabled={editSaving}
                      className="w-full bg-white/90 border border-espresso/10 rounded-[18px] px-4 py-3 text-sm text-espresso shadow-[0_10px_26px_rgba(46,26,17,0.04)] focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 disabled:opacity-50"
                    >
                      <option value="">Select package</option>
                      {allPackages.map(pkg => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.serviceName} - {pkg.name} ({formatPeso(pkg.price)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Booking Date"
                      type="date"
                      min={getDateInputValue()}
                      value={editForm.scheduled_date}
                      onChange={(e) => handleEditDateChange(e.target.value)}
                      disabled={editSaving}
                    />
                    <label className="block space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] block text-espresso/70">Available Time Slot</span>
                      <select
                        value={editForm.scheduled_time}
                        onChange={(e) => setEditForm(current => ({ ...current, scheduled_time: e.target.value }))}
                        disabled={editSaving || editSlotLoading || !editForm.scheduled_date || editAvailableSlots.length === 0}
                        className="w-full bg-white/90 border border-espresso/10 rounded-[18px] px-4 py-3 text-sm text-espresso shadow-[0_10px_26px_rgba(46,26,17,0.04)] focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 disabled:opacity-50"
                      >
                        <option value="">{editSlotLoading ? 'Loading slots...' : 'Select available slot'}</option>
                        {editAvailableSlots.map(slot => (
                          <option key={slot.time} value={slot.time} disabled={!slot.available}>
                            {slot.label} {slot.available ? '' : slot.status === 'BOOKED' ? '- Booked' : '- Unavailable'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {editAvailableSlots.map(slot => (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.available || editSaving}
                        onClick={() => setEditForm(current => ({ ...current, scheduled_time: slot.time }))}
                        className={`rounded-2xl border px-3 py-2 text-[11px] font-black transition-all ${
                          editForm.scheduled_time === slot.time
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

                  <Textarea
                    label="Notes"
                    rows={4}
                    value={editForm.notes}
                    onChange={(e) => setEditForm(current => ({ ...current, notes: e.target.value }))}
                    disabled={editSaving}
                    placeholder="Add requests, reminders, or shoot details..."
                  />
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="First Name"
                      value={editForm.first_name}
                      onChange={(e) => setEditForm(current => ({ ...current, first_name: e.target.value }))}
                      disabled={editSaving}
                    />
                    <Input
                      label="Last Name"
                      value={editForm.last_name}
                      onChange={(e) => setEditForm(current => ({ ...current, last_name: e.target.value }))}
                      disabled={editSaving}
                    />
                  </div>
                  <Input
                    label="Email"
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm(current => ({ ...current, email: e.target.value }))}
                    disabled={editSaving}
                  />
                  <Input
                    label="Phone Number"
                    value={editForm.phone_number}
                    onChange={(e) => setEditForm(current => ({ ...current, phone_number: e.target.value }))}
                    disabled={editSaving}
                  />
                  <Textarea
                    label="Address"
                    rows={3}
                    value={editForm.address}
                    onChange={(e) => setEditForm(current => ({ ...current, address: e.target.value }))}
                    disabled={editSaving}
                  />
                  <Input
                    label="Reason"
                    value={editForm.change_reason}
                    onChange={(e) => setEditForm(current => ({ ...current, change_reason: e.target.value }))}
                    disabled={editSaving}
                  />
                </div>
              </div>

              {editError && (
                <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-xs font-bold text-red-700">
                  {editError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <Button variant="outline" onClick={closeEditBooking} disabled={editSaving}>
                  Keep Current Booking
                </Button>
                <Button
                  variant="gold"
                  onClick={() => setEditConfirmOpen(true)}
                  disabled={editSaving || !editForm.package || !editForm.scheduled_date || !editForm.scheduled_time || !editingBooking.can_edit}
                >
                  Review Updated Session
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          open={editConfirmOpen}
          onClose={() => !editSaving && setEditConfirmOpen(false)}
          title="Confirm Booking Update"
          size="sm"
        >
          {editForm && (
            <div className="space-y-5">
              <p className="text-sm text-espresso/70 leading-relaxed">
                Save these changes to your booking? Staff will be notified and availability will be rechecked before saving.
              </p>
              <div className="rounded-2xl bg-cream/70 border border-espresso/5 p-4 text-xs space-y-2">
                <div className="flex justify-between gap-3">
                  <span className="font-black uppercase tracking-wider text-espresso/45">Package</span>
                  <span className="font-bold text-espresso text-right">{editSelectedPackage?.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="font-black uppercase tracking-wider text-espresso/45">Schedule</span>
                  <span className="font-bold text-espresso text-right">{editForm.scheduled_date} at {editForm.scheduled_time}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="font-black uppercase tracking-wider text-espresso/45">Total</span>
                  <span className="font-black text-gold-dark text-right">{formatPeso(editTotal)}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setEditConfirmOpen(false)} disabled={editSaving}>
                  Back to Edits
                </Button>
                <Button variant="gold" className="flex-1" onClick={submitEditBooking} loading={editSaving} disabled={editSaving}>
                  {editSaving ? 'Updating Session...' : 'Confirm Session Update'}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          open={!!selectedBookingDetails}
          onClose={() => setSelectedBookingDetails(null)}
          title="Booking Details"
          size="lg"
        >
          {selectedBookingDetails && (
            <div className="space-y-5">
              {(() => {
                const contact = getBookingContact(selectedBookingDetails);
                return (
                  <div className="rounded-2xl bg-white border border-espresso/5 p-4 text-xs">
                    <p className="text-espresso/45 font-black uppercase tracking-wider mb-3">Customer Contact</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl bg-cream/60 border border-espresso/5 p-3">
                        <p className="inline-flex items-center gap-1.5 text-espresso/45 font-black uppercase tracking-wider">
                          <User className="w-3.5 h-3.5 text-gold-dark" />
                          Name
                        </p>
                        <p className="font-bold text-espresso mt-1">{getBookingCustomerName(selectedBookingDetails)}</p>
                      </div>
                      <div className="rounded-xl bg-cream/60 border border-espresso/5 p-3">
                        <p className="inline-flex items-center gap-1.5 text-espresso/45 font-black uppercase tracking-wider">
                          <Phone className="w-3.5 h-3.5 text-gold-dark" />
                          Phone
                        </p>
                        <p className="font-bold text-espresso mt-1 break-all">{contact.phone}</p>
                      </div>
                      <div className="rounded-xl bg-cream/60 border border-espresso/5 p-3 sm:col-span-2">
                        <p className="inline-flex items-center gap-1.5 text-espresso/45 font-black uppercase tracking-wider">
                          <Mail className="w-3.5 h-3.5 text-gold-dark" />
                          Email
                        </p>
                        <p className="font-bold text-espresso mt-1 break-all">{contact.email}</p>
                      </div>
                      {contact.address && (
                        <div className="rounded-xl bg-cream/60 border border-espresso/5 p-3 sm:col-span-2">
                          <p className="inline-flex items-center gap-1.5 text-espresso/45 font-black uppercase tracking-wider">
                            <MapPin className="w-3.5 h-3.5 text-gold-dark" />
                            Address
                          </p>
                          <p className="font-bold text-espresso mt-1">{contact.address}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-2xl bg-cream/70 border border-espresso/5 p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-espresso mt-1">{selectedBookingDetails.package_details?.name || 'Photography Package'}</h3>
                    <p className="text-xs text-espresso/55">{selectedBookingDetails.package_details?.service?.name || 'CAV Photo Studio & Cafe'}</p>
                  </div>
                  <span className={`inline-flex items-center self-start gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black ${getStatusMeta(selectedBookingDetails.status).className}`}>
                    {formatStatusLabel(selectedBookingDetails.status)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl border border-espresso/5 bg-white p-4">
                  <p className="text-espresso/45 font-black uppercase tracking-wider">Schedule</p>
                  <p className="font-bold text-espresso mt-1">{selectedBookingDetails.scheduled_date} at {selectedBookingDetails.scheduled_time}</p>
                </div>
                <div className="rounded-2xl border border-espresso/5 bg-white p-4">
                  <p className="text-espresso/45 font-black uppercase tracking-wider">Total</p>
                  <p className="font-bold text-espresso mt-1">{formatPeso(getBookingTotal(selectedBookingDetails))}</p>
                </div>
                <div className="rounded-2xl border border-espresso/5 bg-white p-4">
                  <p className="text-espresso/45 font-black uppercase tracking-wider">Required Down Payment</p>
                  <p className="font-bold text-espresso mt-1">{formatPeso(selectedBookingDetails.required_down_payment)}</p>
                </div>
                <div className="rounded-2xl border border-espresso/5 bg-white p-4">
                  <p className="text-espresso/45 font-black uppercase tracking-wider">Booked On</p>
                  <p className="font-bold text-espresso mt-1">{new Date(selectedBookingDetails.created_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-espresso/5 bg-white p-4 text-xs">
                <p className="text-espresso/45 font-black uppercase tracking-wider mb-3">Add-ons</p>
                {selectedBookingDetails.items?.length > 0 ? (
                  <div className="space-y-2">
                    {selectedBookingDetails.items.map((item) => (
                      <div key={`${item.id}-${item.name}`} className="flex justify-between gap-3 text-espresso/70">
                        <span>{item.name} x{item.quantity}</span>
                        <span className="font-bold text-espresso">{formatPeso(Number(item.price) * Number(item.quantity || 1))}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-espresso/45 font-semibold">No add-ons selected.</p>
                )}
              </div>

              {selectedBookingDetails.notes && (
                <div className="rounded-2xl border border-espresso/5 bg-white p-4 text-xs">
                  <p className="text-espresso/45 font-black uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-espresso/70 leading-relaxed">{selectedBookingDetails.notes}</p>
                </div>
              )}

              <div className="rounded-2xl border border-espresso/5 bg-white p-4 text-xs">
                <p className="text-espresso/45 font-black uppercase tracking-wider mb-3">Payment</p>
                {selectedBookingDetails.payments?.length > 0 ? (
                  <div className="space-y-3">
                    {selectedBookingDetails.payments.map((payment) => (
                      <div key={payment.id} className="rounded-xl bg-cream/60 border border-espresso/5 p-3 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <span className="font-bold text-espresso break-all">Ref: {payment.reference_number}</span>
                          <span className="font-black text-gold-dark">{formatPeso(payment.amount)}</span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-espresso/55">
                          <span>{new Date(payment.paid_at).toLocaleString()}</span>
                          <span className="font-bold">{formatStatusLabel(payment.status)}</span>
                        </div>
                        {payment.receipt_url && (
                          <a href={payment.receipt_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[11px] font-black text-espresso hover:text-gold-dark">
                            <ReceiptText className="w-3.5 h-3.5" />
                            Open Payment Receipt
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-espresso/45 font-semibold">No payment proof submitted.</p>
                )}
              </div>

              <div className="rounded-2xl border border-espresso/5 bg-white p-4 text-xs">
                <p className="text-espresso/45 font-black uppercase tracking-wider mb-3">Modification History</p>
                {selectedBookingDetails.change_history?.length > 0 ? (
                  <div className="space-y-3">
                    {selectedBookingDetails.change_history.map((change) => (
                      <div key={change.id} className="rounded-xl bg-cream/60 border border-espresso/5 p-3 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <span className="font-bold text-espresso">{change.reason || 'Booking updated'}</span>
                          <span className="text-espresso/45">{new Date(change.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-espresso/55">By {change.changed_by_name}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {Object.keys(change.new_values || {}).map((field) => (
                            <div key={field} className="rounded-lg bg-white/70 border border-espresso/5 p-2">
                              <p className="font-black uppercase tracking-wider text-espresso/40">{field.replace(/_/g, ' ')}</p>
                              <p className="text-espresso/55 line-through">{change.old_values?.[field] || 'Blank'}</p>
                              <p className="font-bold text-espresso">{change.new_values?.[field] || 'Blank'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-espresso/45 font-semibold">No edits recorded yet.</p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {selectedBookingDetails.can_edit && (
                  <Button
                    variant="gold"
                    className="flex-1"
                    onClick={() => {
                      setSelectedBookingDetails(null);
                      openEditBooking(selectedBookingDetails);
                    }}
                  >
                    Refine Booking
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={() => setSelectedBookingDetails(null)}>
                  Back to My Bookings
                </Button>
              </div>
            </div>
          )}
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
                      {msg.role === 'assistant' ? <ChatbotMessageContent content={msg.content} /> : msg.content}
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
                <ChatbotFaqPrompts onSelect={sendChatMessage} disabled={chatLoading} prompts={chatFaqPrompts.length ? chatFaqPrompts : undefined} />
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
