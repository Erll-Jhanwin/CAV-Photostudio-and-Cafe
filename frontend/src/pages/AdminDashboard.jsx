import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client, { DATA_CHANGED_EVENT, getApiErrorMessage } from '../api/client';
import {
  TrendingUp, BarChart2, Users, MessageSquare, Play, Package,
  AlertTriangle, DollarSign, Check, Plus, Trash2, Edit,
  X, Calendar, CreditCard, ClipboardCheck, ShoppingBag, ArrowUpRight,
  ArrowDownRight, Eye, Camera, Printer, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart
} from 'recharts';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/Badge';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonChart, SkeletonStatsCard, SkeletonTable, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import { MobileHeader } from '../components/ui/MobileHeader';
import { DataTable as DashboardTable, PaginationControls, paginateRows, sortRows } from '../components/ui/DataTable';
import { useStyledConfirm } from '../components/ui/StyledAlert';
import { Avatar } from '../components/ui/Avatar';
import { PasswordStrength } from '../components/ui/PasswordStrength';
import {
  getEmailError,
  getPasswordError,
  getRequiredError,
} from '../utils/validation';
import {
  normalizeDashboardAnalytics,
  normalizePayments,
  normalizeRowsById,
} from '../utils/uniqueRecords';
import { formatManilaDateTime, MANILA_TIME_ZONE } from '../utils/dateTime';

const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})}`;

const inventoryStatusMeta = {
  IN_STOCK: { label: 'In Stock', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LOW_STOCK: { label: 'Low Stock', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEAR_EXPIRY: { label: 'Near Expiry', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  EXPIRED: { label: 'Expired', className: 'bg-red-50 text-red-700 border-red-200' },
  OVERSTOCKED: { label: 'Overstocked', className: 'bg-blue-50 text-blue-700 border-blue-200' },
};

const formatDateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayValue = () => formatDateValue(new Date());
const monthValue = (date = new Date()) => formatDateValue(date).slice(0, 7);

const shiftMonthValue = (value, delta) => {
  const [year, month] = String(value || monthValue()).split('-').map(Number);
  const date = new Date(year, (month || 1) - 1 + delta, 1);
  return monthValue(date);
};

const getMonthLabel = (value) => {
  const [year, month] = String(value || monthValue()).split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  });
};

const getCalendarDayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const getCalendarDays = (value) => {
  const [year, month] = String(value || monthValue()).split('-').map(Number);
  const firstDay = new Date(year, (month || 1) - 1, 1);
  const daysInMonth = new Date(year, month || 1, 0).getDate();
  const blanks = Array.from({ length: firstDay.getDay() }, (_, index) => ({ key: `blank-${index}`, blank: true }));
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return {
      key: `${value}-${day}`,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
    };
  });
  return [...blanks, ...days];
};

const getRangeDates = (preset, customStart, customEnd) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  let start = new Date(today);
  let end = new Date(today);

  if (preset === 'yesterday') {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  } else if (preset === 'week') {
    start = startOfWeek;
  } else if (preset === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (preset === 'year') {
    start = new Date(today.getFullYear(), 0, 1);
  } else if (preset === 'custom') {
    start = customStart ? new Date(customStart) : today;
    end = customEnd ? new Date(customEnd) : today;
  }

  return { start: formatDateValue(start), end: formatDateValue(end) };
};

const sumBy = (rows, key) => rows.reduce((total, row) => total + Number(row?.[key] || 0), 0);

const getAverage = (rows, key) => rows.length ? sumBy(rows, key) / rows.length : 0;

const formatChartDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', { timeZone: MANILA_TIME_ZONE, month: 'short', day: 'numeric' });
};

function SalesForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="rounded-2xl border border-espresso/[0.08] bg-white/95 p-3 text-xs shadow-[0_18px_45px_rgba(46,26,17,0.12)]">
      <p className="mb-2 font-black text-espresso">{formatChartDate(label || row.date)}</p>
      {row.actual_sales != null && (
        <p className="font-bold text-espresso/75">Actual: {formatCurrency(row.actual_sales)}</p>
      )}
      {row.forecast_sales != null && (
        <p className="font-bold text-gold-dark">Forecast: {formatCurrency(row.forecast_sales)}</p>
      )}
      {row.combined_sales != null && (
        <p className="font-bold text-espresso">Combined: {formatCurrency(row.combined_sales)}</p>
      )}
      {row.lower_bound != null && row.upper_bound != null && (
        <p className="mt-1 font-semibold text-espresso/50">
          Confidence: {formatCurrency(row.lower_bound)} - {formatCurrency(row.upper_bound)}
        </p>
      )}
    </div>
  );
}

function PerformanceList({ rows, primaryKey, midKey, midLabel }) {
  if (!rows?.length) {
    return <EmptyState icon={Package} title="No performance data" description="Completed transactions will appear here." />;
  }
  return (
    <div className="space-y-2.5 max-h-[300px] overflow-y-auto scrollbar-thin pr-1">
      {rows.map((row, i) => (
        <div key={row[primaryKey]} className="flex items-center justify-between gap-4 rounded-2xl bg-cream/60 border border-espresso/[0.04] p-3.5 animate-in-up" style={{ animationDelay: `${i * 40}ms` }}>
          <div className="min-w-0">
            <p className="font-black text-sm text-espresso truncate">{row[primaryKey]}</p>
            <p className="text-[11px] text-espresso/50">{row[midKey]} {midLabel}</p>
          </div>
          <p className="font-black text-sm text-gold-dark whitespace-nowrap">{formatCurrency(row.revenue)}</p>
        </div>
      ))}
    </div>
  );
}

function AdminSkeleton({ pageTitle }) {
  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <aside className="hidden md:flex w-64 bg-espresso flex-col p-5 shrink-0">
        <Skeleton className="h-12 w-full rounded-xl bg-white/10" />
        <div className="flex-1 space-y-2 mt-8">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-11 w-full rounded-xl bg-white/5" />)}
        </div>
        <div className="space-y-3 pt-4 border-t border-white/10">
          <SkeletonProfileCard />
          <Skeleton className="h-10 w-full rounded-xl bg-white/5" />
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-8 overflow-y-auto">
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <SkeletonStatsCard />
          <SkeletonStatsCard />
          <SkeletonStatsCard />
        </div>
        <SkeletonChart />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8 items-start">
          <div className="lg:col-span-8"><SkeletonTable rows={5} cols={6} /></div>
          <div className="lg:col-span-4"><SkeletonTable rows={3} cols={2} /></div>
        </div>
      </main>
    </div>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useStyledConfirm();
  const [activeTab, setActiveTab] = useState('analytics');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [analytics, setAnalytics] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [bookingPayments, setBookingPayments] = useState([]);
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [studioUnavailableDates, setStudioUnavailableDates] = useState([]);
  const [endOfDayReports, setEndOfDayReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [faqTags, setFaqTags] = useState('');
  const [editingFaq, setEditingFaq] = useState(null);
  const [faqSaving, setFaqSaving] = useState(false);
  const [deletingFaqId, setDeletingFaqId] = useState(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('STAFF');
  const [editingStaff, setEditingStaff] = useState(null);
  const [editStaffForm, setEditStaffForm] = useState({ username: '', email: '', password: '', role: 'STAFF' });
  const [staffSaving, setStaffSaving] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [deletingStaffId, setDeletingStaffId] = useState(null);
  const [newStaffErrors, setNewStaffErrors] = useState({});
  const [editStaffErrors, setEditStaffErrors] = useState({});
  const [faqErrors, setFaqErrors] = useState({});

  const [retrainLoading, setRetrainLoading] = useState(false);
  const [datePreset, setDatePreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [chartGrain, setChartGrain] = useState('daily');
  const [visibleSeries, setVisibleSeries] = useState({
    actual: true,
    forecast: true,
    combined: true,
  });
  const [bookingCalendarMonth, setBookingCalendarMonth] = useState(monthValue());
  const [studioUnavailableDate, setStudioUnavailableDate] = useState(todayValue());
  const [studioUnavailableReason, setStudioUnavailableReason] = useState('');
  const [studioUnavailableSaving, setStudioUnavailableSaving] = useState(false);
  const [studioCalendarError, setStudioCalendarError] = useState('');
  const [bookingPage, setBookingPage] = useState(1);
  const [bookingPageSize, setBookingPageSize] = useState(5);
  const [posPage, setPosPage] = useState(1);
  const [posPageSize, setPosPageSize] = useState(5);
  const [topProductsPage, setTopProductsPage] = useState(1);
  const [topProductsPageSize, setTopProductsPageSize] = useState(5);
  const [topPackagesPage, setTopPackagesPage] = useState(1);
  const [topPackagesPageSize, setTopPackagesPageSize] = useState(5);
  const [reorderPage, setReorderPage] = useState(1);
  const [reorderPageSize, setReorderPageSize] = useState(5);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(5);
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentPageSize, setPaymentPageSize] = useState(10);
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(10);
  const [faqPage, setFaqPage] = useState(1);
  const [faqPageSize, setFaqPageSize] = useState(10);
  const [bookingSort, setBookingSort] = useState({ key: 'created_at', dir: 'desc' });
  const [posSort, setPosSort] = useState({ key: 'date', dir: 'desc' });
  const [reorderSort, setReorderSort] = useState({ key: 'projected_stock', dir: 'asc' });
  const [staffSort, setStaffSort] = useState({ key: 'username', dir: 'asc' });
  const [deletingBookingId, setDeletingBookingId] = useState(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('PENDING_VERIFICATION');
  const [verifyingPaymentId, setVerifyingPaymentId] = useState(null);
  const [receiptPrintError, setReceiptPrintError] = useState('');
  const [endOfDayModalOpen, setEndOfDayModalOpen] = useState(false);
  const [endOfDayDate, setEndOfDayDate] = useState(todayValue());
  const [endOfDayOpeningCash, setEndOfDayOpeningCash] = useState('0.00');
  const [endOfDayCashInOut, setEndOfDayCashInOut] = useState('0.00');
  const [endOfDayCashSales, setEndOfDayCashSales] = useState('');
  const [endOfDayActualCash, setEndOfDayActualCash] = useState('');
  const [endOfDayExpectedCash, setEndOfDayExpectedCash] = useState('');
  const [endOfDayCashLoading, setEndOfDayCashLoading] = useState(false);
  const [endOfDayPrinting, setEndOfDayPrinting] = useState(false);
  const [systemResetOpen, setSystemResetOpen] = useState(false);
  const [systemResetPassword, setSystemResetPassword] = useState('');
  const [systemResetConfirmation, setSystemResetConfirmation] = useState('');
  const [systemResetLoading, setSystemResetLoading] = useState(false);
  const [systemResetError, setSystemResetError] = useState('');
  const dashboardFetchSeqRef = useRef(0);

  const fetchData = useCallback(async ({ background = false } = {}) => {
    const requestSeq = dashboardFetchSeqRef.current + 1;
    dashboardFetchSeqRef.current = requestSeq;
    try {
      if (!background) setLoading(true);
      const range = getRangeDates(datePreset, customStart, customEnd);
      const responses = await Promise.allSettled([
        client.get('/api/dashboard/analytics/', { params: { ...range, grain: chartGrain } }),
        client.get('/api/forecasting/predictions/'),
        client.get('/api/auth/users/'),
        client.get('/api/chatbot/faqs/'),
        client.get('/api/bookings/payments/'),
        client.get('/api/bookings/', { params: { month: bookingCalendarMonth, limit: 500 } }),
        client.get('/api/bookings/studio-unavailable-dates/', { params: { month: bookingCalendarMonth } }),
        client.get('/api/pos/end-of-day-reports/')
      ]);
      if (requestSeq !== dashboardFetchSeqRef.current) return;
      const data = index => responses[index].status === 'fulfilled' ? responses[index].value.data : null;
      if (data(0)) setAnalytics(normalizeDashboardAnalytics(data(0)));
      if (data(1)) setForecast(data(1));
      if (data(2)) setStaffList(normalizeRowsById(data(2), row => row?.username || row?.email));
      if (data(3)) setFaqs(normalizeRowsById(data(3), row => row?.question));
      if (data(4)) setBookingPayments(normalizePayments(data(4)));
      if (data(5)) setCalendarBookings(normalizeRowsById(data(5), row => row?.id));
      if (data(6)) setStudioUnavailableDates(normalizeRowsById(data(6), row => row?.date));
      if (data(7)) setEndOfDayReports(normalizeRowsById(data(7), row => row?.report_number || row?.created_at));

      const failedResponse = responses.find(response => response.status === 'rejected');
      setDataError(failedResponse
        ? `Some dashboard data could not be refreshed. ${getApiErrorMessage(failedResponse.reason)}`
        : '');
    } catch (err) {
      console.error(err);
      if (requestSeq === dashboardFetchSeqRef.current) {
        setDataError(getApiErrorMessage(err, 'Failed to load dashboard data.'));
      }
    } finally {
      if (!background && requestSeq === dashboardFetchSeqRef.current) setLoading(false);
    }
  }, [datePreset, customStart, customEnd, chartGrain, bookingCalendarMonth]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, fetchData]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return undefined;

    const refresh = () => fetchData({ background: true });
    const intervalId = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);

    const handleVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, fetchData]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return undefined;
    const refreshChangedData = () => fetchData({ background: true });
    window.addEventListener(DATA_CHANGED_EVENT, refreshChangedData);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refreshChangedData);
  }, [user, fetchData]);

  const validateNewStaffForm = () => {
    const errors = {
      username: getRequiredError(newUsername, 'Username'),
      password: getPasswordError(newPassword),
      email: getEmailError(newEmail),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const validateEditStaffForm = () => {
    const errors = {
      username: getRequiredError(editStaffForm.username, 'Username'),
      email: getEmailError(editStaffForm.email),
      password: editStaffForm.password.trim() ? getPasswordError(editStaffForm.password, 'New password') : '',
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const validateFAQForm = () => {
    const errors = {
      question: getRequiredError(faqQuestion, 'Question'),
      answer: getRequiredError(faqAnswer, 'Answer'),
    };
    return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
  };

  const newStaffFormValid = !Object.keys(validateNewStaffForm()).length;
  const editStaffFormValid = !Object.keys(validateEditStaffForm()).length;
  const faqFormValid = !Object.keys(validateFAQForm()).length;

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    if (creatingStaff) return;
    const errors = validateNewStaffForm();
    setNewStaffErrors(errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirm({
      title: 'Create Staff Account',
      message: `Create an account for ${newUsername || 'this staff member'}?`,
      confirmLabel: 'Create Account',
      type: 'success',
    });
    if (!confirmed) return;
    try {
      setCreatingStaff(true);
      await client.post('/api/auth/users/', {
        username: newUsername, password: newPassword,
        email: newEmail, role: newRole
      });
      setNewUsername(''); setNewPassword(''); setNewEmail(''); setNewRole('STAFF'); setNewStaffErrors({});
      fetchData();
      alert('Staff account created successfully.');
    } catch (err) {
      const payload = err.response?.data || {};
      setNewStaffErrors(current => ({
        ...current,
        username: payload.username || payload.detail || current.username,
        email: Array.isArray(payload.email) ? payload.email.join(' ') : payload.email || current.email,
        password: Array.isArray(payload.password) ? payload.password.join(' ') : payload.password || current.password,
      }));
      alert(payload.detail || 'Failed to create staff account.');
    } finally {
      setCreatingStaff(false);
    }
  };

  const openStaffEditModal = (staff) => {
    setEditingStaff(staff);
    setEditStaffForm({
      username: staff.username || '',
      email: staff.email || '',
      password: '',
      role: staff.role || 'STAFF',
    });
    setEditStaffErrors({});
  };

  const handleUpdateStaff = async (e) => {
    e.preventDefault();
    if (!editingStaff || staffSaving) return;
    const errors = validateEditStaffForm();
    setEditStaffErrors(errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirm({
      title: 'Update Staff Account',
      message: `Save changes to ${editingStaff.username}?`,
      confirmLabel: 'Update Account',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      setStaffSaving(true);
      const payload = {
        username: editStaffForm.username,
        email: editStaffForm.email,
        role: editStaffForm.role,
      };
      if (editStaffForm.password.trim()) {
        payload.password = editStaffForm.password;
      }
      const res = await client.patch(`/api/auth/users/${editingStaff.id}/`, payload);
      setStaffList(current => normalizeRowsById(current.map(staff => staff.id === editingStaff.id ? res.data : staff), row => row?.username || row?.email));
      setEditingStaff(null);
      setEditStaffForm({ username: '', email: '', password: '', role: 'STAFF' });
      setEditStaffErrors({});
      alert('Record updated successfully.');
    } catch (err) {
      const payload = err.response?.data || {};
      setEditStaffErrors(current => ({
        ...current,
        username: payload.username || payload.detail || current.username,
        email: Array.isArray(payload.email) ? payload.email.join(' ') : payload.email || current.email,
        password: Array.isArray(payload.password) ? payload.password.join(' ') : payload.password || current.password,
      }));
      alert(payload.detail || 'Failed to update account.');
    } finally {
      setStaffSaving(false);
    }
  };

  const handleDeleteStaff = async (staff) => {
    if (deletingStaffId === staff.id) return;
    const confirmed = await confirm({
      title: 'Delete Staff Account',
      message: `Delete account for ${staff.username}? This cannot be undone.`,
      confirmLabel: 'Delete Account',
      type: 'error',
    });
    if (!confirmed) return;
    try {
      setDeletingStaffId(staff.id);
      await client.delete(`/api/auth/users/${staff.id}/`);
      setStaffList(current => current.filter(item => item.id !== staff.id));
      setStaffPage(page => Math.max(1, Math.min(page, Math.ceil((staffList.length - 1) / staffPageSize) || 1)));
      alert('Record deleted successfully.');
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete account.');
    } finally {
      setDeletingStaffId(null);
    }
  };

  const handleFAQSubmit = async (e) => {
    e.preventDefault();
    if (faqSaving) return;
    const errors = validateFAQForm();
    setFaqErrors(errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirm({
      title: editingFaq ? 'Update FAQ' : 'Add FAQ',
      message: editingFaq ? 'Save changes to this FAQ?' : 'Add this FAQ to the chatbot knowledge base?',
      confirmLabel: editingFaq ? 'Update FAQ' : 'Add FAQ',
      type: editingFaq ? 'warning' : 'success',
    });
    if (!confirmed) return;
    try {
      setFaqSaving(true);
      if (editingFaq) {
        await client.put(`/api/chatbot/faqs/${editingFaq.id}/`, {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
      } else {
        await client.post('/api/chatbot/faqs/', {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
      }
      setFaqQuestion(''); setFaqAnswer(''); setFaqTags(''); setEditingFaq(null); setFaqErrors({});
      fetchData();
      alert(editingFaq ? 'Record updated successfully.' : 'Record added successfully.');
    } catch {
      alert('Failed to save FAQ.');
    } finally {
      setFaqSaving(false);
    }
  };

  const handleRetrain = async () => {
    setRetrainLoading(true);
    setTimeout(() => {
      setRetrainLoading(false);
      fetchData();
    }, 1500);
  };

  const handleDeleteFAQ = async (id) => {
    if (deletingFaqId === id) return;
    const confirmed = await confirm({
      title: 'Delete FAQ',
      message: 'Delete this FAQ? This cannot be undone.',
      confirmLabel: 'Delete FAQ',
      type: 'error',
    });
    if (!confirmed) return;
    try {
      setDeletingFaqId(id);
      await client.delete(`/api/chatbot/faqs/${id}/`);
      fetchData();
      alert('Record deleted successfully.');
    } catch {
      alert('Failed to delete FAQ.');
    } finally {
      setDeletingFaqId(null);
    }
  };

  const handleDeleteBooking = async (booking) => {
    if (deletingBookingId === booking.id) return;
    const confirmed = await confirm({
      title: 'Delete Booking',
      message: `Delete booking for ${booking.customer_name}? This cannot be undone.`,
      confirmLabel: 'Delete Booking',
      type: 'error',
    });
    if (!confirmed) return;
    try {
      setDeletingBookingId(booking.id);
      await client.delete(`/api/bookings/${booking.id}/`);
      setAnalytics(current => {
        if (!current) return current;
        const statusKey = booking.status?.toLowerCase();
        const metrics = { ...(current.metrics || {}) };
        metrics.total_bookings = Math.max((metrics.total_bookings || 0) - 1, 0);
        if (statusKey && metrics[statusKey] !== undefined) {
          metrics[statusKey] = Math.max((metrics[statusKey] || 0) - 1, 0);
        }
        if (booking.status === 'COMPLETED') {
          metrics.completed_bookings = Math.max((metrics.completed_bookings || 0) - 1, 0);
        }
        return normalizeDashboardAnalytics({
          ...current,
          metrics,
          recent_bookings: (current.recent_bookings || []).filter(row => row.id !== booking.id),
        });
      });
      setBookingPage(page => Math.max(1, Math.min(page, Math.ceil((sortedBookings.length - 1) / bookingPageSize) || 1)));
      fetchData({ background: true });
      alert('Record deleted successfully.');
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete booking.');
    } finally {
      setDeletingBookingId(null);
    }
  };

  const handleCreateStudioUnavailable = async (e) => {
    e.preventDefault();
    if (studioUnavailableSaving) return;
    const cleanReason = studioUnavailableReason.trim();
    if (!studioUnavailableDate || cleanReason.length < 3) {
      setStudioCalendarError('Choose a date and enter a reason.');
      return;
    }
    const confirmed = await confirm({
      title: 'Mark Studio Unavailable',
      message: `Block Studio Session slots on ${studioUnavailableDate}?`,
      confirmLabel: 'Mark Unavailable',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      setStudioUnavailableSaving(true);
      setStudioCalendarError('');
      await client.post('/api/bookings/studio-unavailable-dates/', {
        date: studioUnavailableDate,
        reason: cleanReason,
      });
      setStudioUnavailableReason('');
      setBookingCalendarMonth(studioUnavailableDate.slice(0, 7));
      fetchData({ background: true });
      alert('Studio unavailable date saved.');
    } catch (err) {
      const data = err.response?.data || {};
      setStudioCalendarError(data.date || data.reason || data.detail || 'Could not save studio unavailable date.');
    } finally {
      setStudioUnavailableSaving(false);
    }
  };

  const handleDeleteStudioUnavailable = async (row) => {
    const confirmed = await confirm({
      title: 'Remove Studio Block',
      message: `Remove studio unavailable marker for ${row.date}?`,
      confirmLabel: 'Remove Block',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      await client.delete(`/api/bookings/studio-unavailable-dates/${row.id}/`);
      fetchData({ background: true });
      alert('Studio unavailable date removed.');
    } catch (err) {
      setStudioCalendarError(err.response?.data?.detail || 'Could not remove studio unavailable date.');
    }
  };

  const handleCalendarBookingStatus = async (booking, newStatus) => {
    if (!newStatus || newStatus === booking.status) return;
    const confirmed = await confirm({
      title: 'Update Booking Status',
      message: `Set booking #${booking.id} to ${newStatus}?`,
      confirmLabel: 'Update Status',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      await client.patch(`/api/bookings/${booking.id}/`, { status: newStatus });
      fetchData({ background: true });
      alert('Booking status updated.');
    } catch (err) {
      setStudioCalendarError(err.response?.data?.detail || err.response?.data?.status || 'Could not update booking status.');
    }
  };

  const handleVerifyBookingPayment = async (payment, newStatus) => {
    const action = newStatus === 'APPROVED' ? 'approve' : 'reject';
    if (verifyingPaymentId === payment.id) return;
    const confirmed = await confirm({
      title: `${newStatus === 'APPROVED' ? 'Approve' : 'Reject'} Payment`,
      message: `Are you sure you want to ${action} payment ${payment.reference_number}?`,
      confirmLabel: newStatus === 'APPROVED' ? 'Approve Payment' : 'Reject Payment',
      type: newStatus === 'APPROVED' ? 'success' : 'error',
    });
    if (!confirmed) return;
    try {
      setVerifyingPaymentId(payment.id);
      const res = await client.patch(`/api/bookings/payments/${payment.id}/verify/`, { status: newStatus });
      setBookingPayments(current => normalizePayments(current.map(item => item.id === payment.id ? res.data : item)));
      fetchData({ background: true });
      alert(`Payment ${newStatus === 'APPROVED' ? 'approved' : 'rejected'} successfully.`);
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.status || 'Failed to verify payment.');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  const getEndOfDayExpectedCashValue = (
    openingCash = endOfDayOpeningCash,
    cashSales = endOfDayCashSales,
    cashInOut = endOfDayCashInOut
  ) => Number(openingCash || 0) + Number(cashSales || 0) + Number(cashInOut || 0);

  const getExpectedCashForDate = async (dateValue) => {
    setEndOfDayCashLoading(true);
    try {
      const res = await client.get('/api/pos/orders/', { params: { limit: 200 } });
      const cashTotal = res.data
        .filter(order => {
          const orderDate = order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : '';
          const paidCash = order.payment_status === 'PAID' && order.payments?.some(payment => payment.method === 'CASH');
          return orderDate === dateValue && paidCash;
        })
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
      const cashSales = cashTotal.toFixed(2);
      const expectedCash = getEndOfDayExpectedCashValue(endOfDayOpeningCash, cashSales, endOfDayCashInOut).toFixed(2);
      setEndOfDayCashSales(cashSales);
      setEndOfDayExpectedCash(expectedCash);
      setEndOfDayActualCash(expectedCash);
    } catch {
      setEndOfDayCashSales('');
      setEndOfDayExpectedCash('');
      setEndOfDayActualCash('');
    } finally {
      setEndOfDayCashLoading(false);
    }
  };

  const openEndOfDayModal = async (dateValue = todayValue()) => {
    setEndOfDayDate(dateValue);
    setEndOfDayModalOpen(true);
    await getExpectedCashForDate(dateValue);
  };

  const handleEndOfDayDateChange = async (dateValue) => {
    setEndOfDayDate(dateValue);
    await getExpectedCashForDate(dateValue);
  };

  const handlePrintEndOfDayReport = async () => {
    const openingCash = Number(endOfDayOpeningCash || 0);
    const cashInOut = Number(endOfDayCashInOut || 0);
    const actualCash = Number(endOfDayActualCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      alert('Enter a valid opening cash amount.');
      return;
    }
    if (!Number.isFinite(cashInOut)) {
      alert('Enter a valid cash in/out amount.');
      return;
    }
    if (!endOfDayActualCash || !Number.isFinite(actualCash) || actualCash < 0) {
      alert('Enter the actual cash counted in the drawer.');
      return;
    }
    const confirmed = await confirm({
      title: 'Print End-of-Day Report',
      message: `Print and save the end-of-day report for ${endOfDayDate}?`,
      confirmLabel: 'Print Report',
      type: 'success',
    });
    if (!confirmed) return;

    try {
      setEndOfDayPrinting(true);
      setReceiptPrintError('');
      const res = await client.post('/api/pos/end-of-day-reports/', {
        report_date: endOfDayDate,
        opening_cash: openingCash.toFixed(2),
        cash_in_out: cashInOut.toFixed(2),
        actual_cash: actualCash.toFixed(2),
      });
      setEndOfDayReports(current => normalizeRowsById([res.data, ...current.filter(report => report.id !== res.data.id)], row => row?.report_number || row?.created_at));
      setEndOfDayModalOpen(false);
      setEndOfDayActualCash('');
      setEndOfDayOpeningCash('0.00');
      setEndOfDayCashInOut('0.00');
      setEndOfDayCashSales('');
      setEndOfDayExpectedCash('');
      if (!res.data.receipt_print?.printed) {
        setReceiptPrintError(res.data.receipt_print?.error || 'Report saved, but the end-of-day receipt could not be printed.');
      }
      alert('End-of-day report saved successfully.');
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to print end-of-day report.';
      alert(message);
    } finally {
      setEndOfDayPrinting(false);
    }
  };

  const handleReprintEndOfDayReport = async (report) => {
    const confirmed = await confirm({
      title: 'Reprint Report',
      message: `Reprint end-of-day report for ${report.report_date}?`,
      confirmLabel: 'Reprint Report',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      setReceiptPrintError('');
      const res = await client.post(`/api/pos/end-of-day-reports/${report.id}/reprint/`);
      setEndOfDayReports(current => normalizeRowsById(current.map(item => item.id === report.id ? res.data : item), row => row?.report_number || row?.created_at));
      if (!res.data.receipt_print?.printed) {
        setReceiptPrintError(res.data.receipt_print?.error || 'Report found, but the receipt could not be printed.');
      }
      alert('Report reprinted successfully.');
    } catch {
      alert('Failed to reprint report.');
    }
  };

  const handleLogout = useCallback(() => {
    alert('Signed out successfully.');
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const openSystemResetModal = () => {
    setSystemResetPassword('');
    setSystemResetConfirmation('');
    setSystemResetError('');
    setSystemResetOpen(true);
  };

  const closeSystemResetModal = () => {
    if (systemResetLoading) return;
    setSystemResetOpen(false);
    setSystemResetPassword('');
    setSystemResetConfirmation('');
    setSystemResetError('');
  };

  const handleSystemReset = async (e) => {
    e.preventDefault();
    if (systemResetLoading) return;

    setSystemResetError('');
    setSystemResetLoading(true);
    try {
      await client.post('/api/admin/system-reset/', {
        admin_password: systemResetPassword,
        confirmation: systemResetConfirmation,
      });
      await fetchData({ background: true });
      setSystemResetOpen(false);
      setSystemResetPassword('');
      setSystemResetConfirmation('');
      setSystemResetError('');
      alert('System reset completed successfully.');
    } catch (err) {
      const payload = err.response?.data;
      const msg = payload?.detail
        || payload?.admin_password
        || payload?.confirmation
        || 'System reset failed. Please verify your password and try again.';
      setSystemResetError(Array.isArray(msg) ? msg.join(' ') : msg);
    } finally {
      setSystemResetLoading(false);
    }
  };

  if (loading) return <AdminSkeleton />;

  const navItems = [
    { key: 'analytics', label: 'InsightHub Dashboard', icon: BarChart2, active: activeTab === 'analytics', onClick: () => setActiveTab('analytics') },
    { key: 'calendar', label: 'Booking Calendar', icon: Calendar, active: activeTab === 'calendar', onClick: () => setActiveTab('calendar') },
    { key: 'reports', label: 'End-of-Day Reports', icon: Printer, active: activeTab === 'reports', onClick: () => setActiveTab('reports') },
    { key: 'payments', label: 'Payment Booking Verification', icon: CreditCard, active: activeTab === 'payments', onClick: () => setActiveTab('payments') },
    { key: 'staff', label: 'Staff Accounts', icon: Users, active: activeTab === 'staff', onClick: () => setActiveTab('staff') },
    { key: 'faq', label: 'Chatbot Manager', icon: MessageSquare, active: activeTab === 'faq', onClick: () => setActiveTab('faq') },
    { key: 'system', label: 'System Controls', icon: AlertTriangle, active: activeTab === 'system', onClick: () => setActiveTab('system') },
  ];

  const pageTitles = { analytics: 'InsightHub Dashboard', calendar: 'Booking Calendar', reports: 'End-of-Day Reports', payments: 'Payment Booking Verification', staff: 'Staff Accounts', faq: 'Chatbot Manager', system: 'System Controls' };
  const metrics = analytics?.metrics || {};
  const statusData = [
    { label: 'Pending', value: metrics.pending || 0, color: '#F59E0B' },
    { label: 'Confirmed', value: metrics.confirmed || 0, color: '#3B82F6' },
    { label: 'Completed', value: metrics.completed || 0, color: '#10B981' },
    { label: 'Cancelled', value: metrics.cancelled || 0, color: '#EF4444' },
  ];
  const revenueTotal = Number(metrics.pos_revenue || 0) + Number(metrics.booking_revenue || 0);
  const toggleSort = (current, setter, key) => {
    setter(current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const sortedBookings = sortRows(analytics?.recent_bookings, bookingSort);
  const sortedPos = sortRows(analytics?.recent_pos_transactions, posSort);
  const bookingPageRows = paginateRows(sortedBookings, bookingPage, bookingPageSize);
  const posPageRows = paginateRows(sortedPos, posPage, posPageSize);
  const salesForecastRows = forecast?.sales_forecast || [];
  const salesHistoryRows = analytics?.sales_history_chart || [];
  const forecastChartData = [
    ...salesHistoryRows.map(row => ({
      date: row.date,
      actual_sales: Number(row.total_revenue || 0),
      combined_sales: Number(row.total_revenue || 0),
    })),
    ...salesForecastRows.map(row => ({
      date: row.target_date,
      forecast_sales: Number(row.predicted_sales || 0),
      combined_sales: Number(row.predicted_sales || 0),
      lower_bound: Number(row.lower_bound || 0),
      upper_bound: Number(row.upper_bound || 0),
    })),
  ];
  const nextDayForecast = Number(salesForecastRows[0]?.predicted_sales || 0);
  const nextWeekForecast = sumBy(salesForecastRows, 'predicted_sales');
  const nextMonthForecast = Math.round(getAverage(salesForecastRows, 'predicted_sales') * 30);
  const forecastAccuracy = salesForecastRows.length
    ? Math.round(Math.max(0, Math.min(99, 100 - (
      salesForecastRows.reduce((total, row) => {
        const predicted = Math.max(Number(row.predicted_sales || 0), 1);
        const intervalWidth = Math.max(Number(row.upper_bound || 0) - Number(row.lower_bound || 0), 0);
        return total + ((intervalWidth / predicted) * 35);
      }, 0) / salesForecastRows.length
    ))))
    : 0;
  const topProducts = analytics?.top_selling_products || [];
  const topPackages = analytics?.top_booked_packages || [];
  const topProductRows = paginateRows(topProducts, topProductsPage, topProductsPageSize);
  const topPackageRows = paginateRows(topPackages, topPackagesPage, topPackagesPageSize);
  const reorderRows = forecast?.reorder_recommendations || [];
  const sortedReorderRows = sortRows(reorderRows, reorderSort);
  const reorderPageRows = paginateRows(sortedReorderRows, reorderPage, reorderPageSize);
  const inventoryCounts = analytics?.inventory_status_counts || {};
  const inventorySummary = Object.entries(inventoryStatusMeta).map(([key, meta]) => ({
    key,
    ...meta,
    value: inventoryCounts[key] || 0,
  }));
  const filteredBookingPayments = bookingPayments.filter(payment => (
    paymentStatusFilter === 'ALL' || payment.status === paymentStatusFilter
  ));
  const paymentPageRows = paginateRows(filteredBookingPayments, paymentPage, paymentPageSize);
  const reportPageRows = paginateRows(endOfDayReports, reportsPage, reportsPageSize);
  const sortedStaffList = sortRows(staffList, staffSort);
  const staffPageRows = paginateRows(sortedStaffList, staffPage, staffPageSize);
  const faqPageRows = paginateRows(faqs, faqPage, faqPageSize);
  const paymentStatusCounts = bookingPayments.reduce((acc, payment) => {
    acc[payment.status] = (acc[payment.status] || 0) + 1;
    return acc;
  }, {});
  const calendarDays = getCalendarDays(bookingCalendarMonth);
  const calendarMonthBookings = calendarBookings.filter(booking => String(booking.scheduled_date || '').startsWith(bookingCalendarMonth));
  const isEventBooking = (booking) => {
    const packageName = (booking.package_details?.name || '').toLowerCase();
    return packageName.includes('event') || packageName.includes('photo service');
  };
  const getCalendarBookingName = (booking) => (
    booking.customer?.first_name || booking.customer?.last_name
      ? `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim()
      : booking.customer?.username || `Booking #${booking.id}`
  );
  const bookingsByDate = calendarMonthBookings.reduce((acc, booking) => {
    const key = booking.scheduled_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(booking);
    return acc;
  }, {});
  const unavailableByDate = studioUnavailableDates.reduce((acc, row) => {
    acc[row.date] = row;
    return acc;
  }, {});
  const eventBlockedDates = calendarMonthBookings.reduce((acc, booking) => {
    if (isEventBooking(booking)) acc.add(booking.scheduled_date);
    return acc;
  }, new Set());
  const calendarBookingStatusOptions = ['PENDING', 'CONFIRMED', 'CONFIRMED_DP', 'COMPLETED', 'CANCELLED'];
  const displayedEndOfDayExpectedCash = endOfDayExpectedCash || getEndOfDayExpectedCashValue().toFixed(2);

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <Sidebar
        brand="CAV Admin"
        brandSubtitle="Management Console"
        brandIcon={TrendingUp}
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
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} user={user} />

        <main className={`flex-1 min-h-0 p-3 sm:p-4 lg:p-5 scrollbar-thin ${activeTab === 'reports' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {receiptPrintError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl mb-6 flex items-start gap-3 shadow-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm">Receipt Not Printed</h4>
                <p className="text-xs text-amber-700/90 mt-1">{receiptPrintError}</p>
              </div>
              <button type="button" onClick={() => setReceiptPrintError('')} className="text-amber-700/70 hover:text-amber-900">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {dataError && (
            <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-2xl mb-6 flex items-start gap-3 shadow-sm" role="alert">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="flex-1 text-xs font-semibold">{dataError}</p>
              <Button variant="outline" size="sm" onClick={() => fetchData()} className="border-red-200 bg-white text-red-800 hover:bg-red-100">Retry</Button>
            </div>
          )}

          {/* INSIGHTHUB DASHBOARD */}
          {activeTab === 'analytics' && (
            <div className="w-full space-y-4 animate-in-up" key="analytics">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-gold-dark font-black mb-1">CAV InsightHub</p>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Business Overview</h1>
                  <p className="text-xs text-espresso/55 mt-1">Real-time sales, bookings, POS activity, and performance insights.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="bg-white/80 backdrop-blur-xl border border-espresso/[0.06] shadow-[0_14px_34px_rgba(46,26,17,0.06)] rounded-[20px] p-2 flex flex-col sm:flex-row gap-2">
                    <select
                      aria-label="Date range"
                      value={datePreset}
                      onChange={e => setDatePreset(e.target.value)}
                      className="rounded-2xl bg-cream/70 border border-espresso/10 px-3 py-2 text-xs font-bold text-espresso focus:outline-none focus:ring-4 focus:ring-gold/15"
                    >
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="week">This Week</option>
                      <option value="month">This Month</option>
                      <option value="year">This Year</option>
                      <option value="custom">Custom Date Range</option>
                    </select>
                    {datePreset === 'custom' && (
                      <>
                        <input type="date" aria-label="Custom start date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="rounded-2xl bg-cream/70 border border-espresso/10 px-3 py-2 text-xs font-bold text-espresso focus:outline-none focus:ring-4 focus:ring-gold/15" />
                        <input type="date" aria-label="Custom end date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="rounded-2xl bg-cream/70 border border-espresso/10 px-3 py-2 text-xs font-bold text-espresso focus:outline-none focus:ring-4 focus:ring-gold/15" />
                      </>
                    )}
                  </div>
                  <Button variant="primary" size="sm" loading={retrainLoading} icon={Play} onClick={handleRetrain}>
                    {retrainLoading ? 'Modeling...' : 'Refresh Forecast'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
                {[
                  {
                    label: 'Total Sales',
                    value: formatCurrency(metrics.total_revenue),
                    detail: `${Math.abs(metrics.total_revenue_change || 0)}% ${Number(metrics.total_revenue_change || 0) >= 0 ? 'increase' : 'decrease'} vs previous period`,
                    icon: DollarSign,
                    trend: Number(metrics.total_revenue_change || 0) >= 0 ? ArrowUpRight : ArrowDownRight,
                    trendClass: Number(metrics.total_revenue_change || 0) >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50',
                  },
                  {
                    label: 'Booking Income',
                    value: formatCurrency(metrics.booking_revenue),
                    detail: `${metrics.completed_bookings || 0} completed bookings`,
                    icon: Camera,
                    trend: ArrowUpRight,
                    trendClass: 'text-gold-dark bg-gold/10',
                  },
                  {
                    label: 'Total Bookings',
                    value: metrics.total_bookings || 0,
                    detail: `P ${metrics.pending || 0} · C ${metrics.confirmed || 0} · Done ${metrics.completed || 0} · X ${metrics.cancelled || 0}`,
                    icon: ClipboardCheck,
                    trend: Calendar,
                    trendClass: 'text-blue-700 bg-blue-50',
                  },
                  {
                    label: 'POS Transactions',
                    value: metrics.transaction_count || 0,
                    detail: `${formatCurrency(metrics.avg_transaction_value)} avg · ${metrics.total_items_sold || 0} items sold`,
                    icon: CreditCard,
                    trend: ShoppingBag,
                    trendClass: 'text-amber-700 bg-amber-50',
                  },
                ].map((item, i) => {
                  const Icon = item.icon;
                  const TrendIcon = item.trend;
                  return (
                    <div key={item.label} className="group rounded-[20px] bg-white/85 backdrop-blur-xl border border-espresso/[0.06] p-4 shadow-[0_18px_46px_rgba(46,26,17,0.075)] hover:shadow-[0_26px_70px_rgba(46,26,17,0.12)] hover:-translate-y-1 active:scale-[0.99] transition-all duration-300 animate-in-up" style={{ animationDelay: `${i * 55}ms` }}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="w-11 h-11 rounded-2xl bg-cream-dark text-gold-dark flex items-center justify-center">
                          <Icon className="w-5 h-5" />
                        </span>
                        <span className={`w-8 h-8 rounded-2xl flex items-center justify-center ${item.trendClass}`}>
                          <TrendIcon className="w-4 h-4" />
                        </span>
                      </div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-espresso/45 font-black mt-3">{item.label}</p>
                      <p className="text-2xl md:text-3xl font-black text-espresso mt-1 leading-tight">{item.value}</p>
                      <p className="text-[11px] text-espresso/55 mt-2">{item.detail}</p>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-4 md:gap-5">
                  <Card padding={false}>
                    <div className="p-5 md:p-6">
                      <CardHeader title="Ingredient Stock Management" subtitle="Raw ingredient health monitored from staff inventory activity" className="mb-4" />
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        {inventorySummary.map(status => (
                          <div key={status.key} className="rounded-2xl bg-cream/60 border border-espresso/[0.05] p-3">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}>
                              {status.label}
                            </span>
                            <p className="font-sans text-2xl font-extrabold text-espresso mt-2">{status.value}</p>
                            <p className="text-[10px] text-espresso/45 uppercase font-black">ingredient{status.value === 1 ? '' : 's'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                    <Card padding={false}>
                      <div className="p-5">
                        <CardHeader title="Revenue Sources" className="mb-4" />
                        <div className="space-y-4">
                          {[
                            { label: 'POS Income', value: metrics.pos_revenue || 0, color: 'bg-espresso/70' },
                            { label: 'Booking Income', value: metrics.booking_revenue || 0, color: 'bg-gold' },
                          ].map(row => {
                            const pct = revenueTotal ? Math.round((Number(row.value) / revenueTotal) * 100) : 0;
                            return (
                              <div key={row.label}>
                                <div className="flex justify-between text-sm font-bold text-espresso mb-2">
                                  <span>{row.label}</span>
                                  <span>{formatCurrency(row.value)} · {pct}%</span>
                                </div>
                                <div className="h-3 rounded-full bg-cream-dark overflow-hidden">
                                  <div className={`h-full ${row.color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </Card>

                    <Card padding={false}>
                      <div className="p-5">
                        <CardHeader title="Booking Status Summary" className="mb-3" />
                        <div className="grid grid-cols-[120px_1fr] gap-4 items-center">
                          <div className="h-[120px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={36} outerRadius={54} paddingAngle={3}>
                                  {statusData.map(s => <Cell key={s.label} fill={s.color} />)}
                                </Pie>
                                <Tooltip />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="space-y-2.5">
                            {statusData.map(status => (
                              <div key={status.label} className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 font-bold text-espresso"><span className="w-2.5 h-2.5 rounded-full" style={{ background: status.color }} />{status.label}</span>
                                <span className="font-black">{status.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>

              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Predicted Sales',
                    value: formatCurrency(nextDayForecast),
                    detail: salesForecastRows[0] ? `Next day: ${formatChartDate(salesForecastRows[0].target_date)}` : 'Run forecast to generate next-day projection',
                    icon: TrendingUp,
                    className: 'bg-gold/10 text-gold-dark border-gold/20',
                  },
                  {
                    label: 'Expected Revenue',
                    value: formatCurrency(nextWeekForecast),
                    detail: `7-day forecast · 30-day outlook ${formatCurrency(nextMonthForecast)}`,
                    icon: DollarSign,
                    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  },
                  {
                    label: 'Forecast Accuracy',
                    value: salesForecastRows.length ? `${forecastAccuracy}%` : 'N/A',
                    detail: 'Estimated from ML confidence interval width',
                    icon: BarChart2,
                    className: 'bg-blue-50 text-blue-700 border-blue-200',
                  },
                ].map(({ label, value, detail, icon: Icon, className }) => (
                  <div key={label} className={`rounded-2xl border p-4 shadow-sm ${className}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-80">{label}</p>
                        <p className="mt-2 text-2xl font-black">{value}</p>
                      </div>
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70">
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold opacity-75">{detail}</p>
                  </div>
                ))}
              </div>

              <div className="animate-in-up">
                <Card className="rounded-[24px]" padding={false}>
                  <div className="p-5 md:p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
                      <CardHeader title="Sales Analytics" subtitle="Actual sales with ML forecast, projected revenue, and confidence bounds" className="p-0" />
                      <div className="flex flex-wrap gap-2">
                        {['daily', 'weekly', 'monthly'].map(grain => (
                          <button key={grain} onClick={() => setChartGrain(grain)} className={`px-3 py-2 rounded-2xl text-[11px] font-black capitalize transition-all ${chartGrain === grain ? 'bg-espresso text-gold' : 'bg-cream text-espresso/60 hover:text-espresso'}`}>
                            {grain}
                          </button>
                        ))}
                        {[
                          ['actual', 'Actual'],
                          ['forecast', 'Forecast'],
                          ['combined', 'Combined'],
                        ].map(([key, label]) => (
                          <button key={key} onClick={() => setVisibleSeries(v => ({ ...v, [key]: !v[key] }))} className={`px-3 py-2 rounded-2xl text-[11px] font-black transition-all ${visibleSeries[key] ? 'bg-gold text-espresso' : 'bg-cream text-espresso/45'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="h-[300px] 2xl:h-[360px] w-full">
                      {forecastChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={forecastChartData} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5ECE1" />
                            <XAxis dataKey="date" stroke="#2E1A11" fontSize={10} tickLine={false} tickFormatter={formatChartDate} />
                            <YAxis stroke="#2E1A11" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `PHP ${Math.round(Number(value || 0) / 1000)}k`} />
                            <Tooltip content={<SalesForecastTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {visibleSeries.actual && <Line type="monotone" dataKey="actual_sales" name="Actual Sales" stroke="#2E1A11" strokeWidth={3} dot={false} connectNulls={false} />}
                            {visibleSeries.forecast && <Line type="monotone" dataKey="forecast_sales" name="ML Forecast" stroke="#D4AF37" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: '#D4AF37' }} connectNulls={false} />}
                            {visibleSeries.forecast && <Line type="monotone" dataKey="upper_bound" name="Upper Confidence" stroke="#8D6E63" strokeWidth={1.5} strokeDasharray="3 5" dot={false} connectNulls={false} />}
                            {visibleSeries.forecast && <Line type="monotone" dataKey="lower_bound" name="Lower Confidence" stroke="#E57373" strokeWidth={1.5} strokeDasharray="3 5" dot={false} connectNulls={false} />}
                            {visibleSeries.combined && <Line type="monotone" dataKey="combined_sales" name="Combined Actual + Forecast" stroke="#3B82F6" strokeWidth={2.5} dot={false} connectNulls />}
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <EmptyState icon={BarChart2} title="No sales or forecast data" description="Run forecasting or select a date range with completed revenue." />
                      )}
                    </div>
                  </div>
                </Card>
              </div>

              <div className="animate-in-up">
                  <Card className="!p-4 md:!p-5">
                    <CardHeader title="Estimated Stock Depletions &amp; Reorders" subtitle="Based on the active demand forecast." />
                    <DashboardTable
                      columns={[
                        { key: 'product_name', label: 'Product' },
                        { key: 'current_stock', label: 'Stock', align: 'center' },
                        { key: '7_day_forecasted_demand', label: '7-Day Demand', align: 'center', render: rec => <span className="text-gold-dark">{rec["7_day_forecasted_demand"]}</span> },
                        {
                          key: 'projected_stock',
                          label: 'Balance',
                          align: 'center',
                          render: rec => <span className={rec.projected_stock <= 0 ? 'text-red-600' : 'text-espresso/60'}>{rec.projected_stock}</span>,
                        },
                        {
                          key: 'recommended_order_quantity',
                          label: 'Order Qty',
                          align: 'center',
                          render: rec => (
                            <span className="inline-flex justify-center rounded-lg bg-amber-50 px-2.5 py-1 text-[10px] font-bold leading-none text-amber-700">
                              +{rec.recommended_order_quantity}
                            </span>
                          ),
                        },
                        { key: 'supplier_name', label: 'Supplier' },
                      ]}
                      rows={reorderPageRows}
                      sort={reorderSort}
                      onSort={(key) => toggleSort(reorderSort, setReorderSort, key)}
                      emptyIcon={Package}
                      emptyTitle="All stocks optimal"
                      emptyDescription="No reorder actions needed at this time."
                      minWidth={860}
                    />
                    {reorderRows.length > 0 && (
                      <PaginationControls page={reorderPage} setPage={setReorderPage} total={reorderRows.length} pageSize={reorderPageSize} setPageSize={setReorderPageSize} />
                    )}
                  </Card>
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 md:gap-5">
                <div className="animate-in-up">
                <Card padding={false} className="h-[430px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Recent Bookings" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <DashboardTable
                    columns={[
                      { key: 'package_name', label: 'Package', width: 'w-[18%]' },
                      { key: 'customer_name', label: 'Customer', width: 'w-[25%]' },
                      { key: 'scheduled_date', label: 'Booking Date', width: 'w-[16%]' },
                      { key: 'status', label: 'Status', width: 'w-[19%]' },
                      { key: 'amount', label: 'Amount', align: 'right', width: 'w-[16%]' },
                    ]}
                    rows={bookingPageRows}
                    sort={bookingSort}
                    onSort={(key) => toggleSort(bookingSort, setBookingSort, key)}
                    minWidth={680}
                    actionLabel=""
                    actionWidth="w-[52px]"
                    renderCell={(row, key) => key === 'amount'
                      ? formatCurrency(row[key])
                      : key === 'status'
                      ? <StatusBadge status={row[key]} />
                      : key === 'customer_name'
                      ? (
                        <span className="flex min-w-0 max-w-full items-center gap-2">
                          <Avatar user={{ username: row[key], profile_picture_url: row.customer_profile_picture_url }} size="xs" />
                          <span className="min-w-0 truncate font-black text-espresso">{row[key]}</span>
                        </span>
                      )
                      : row[key]}
                    renderActions={(row) => (
                      <button
                        type="button"
                        onClick={() => handleDeleteBooking(row)}
                        disabled={deletingBookingId === row.id}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                        aria-label={`Delete booking for ${row.customer_name || 'customer'}`}
                        title="Remove booking"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  />
                  </div>
                  <PaginationControls page={bookingPage} setPage={setBookingPage} total={sortedBookings.length} pageSize={bookingPageSize} setPageSize={setBookingPageSize} />
                  </div>
                </Card>
                </div>
                <div className="animate-in-up">
                <Card padding={false} className="h-[430px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Recent POS Transactions" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <DashboardTable
                    columns={[
                      ['cashier', 'Cashier'],
                      ['date', 'Date'],
                      ['total', 'Total'],
                      ['payment_method', 'Payment Method'],
                    ]}
                    rows={posPageRows}
                    sort={posSort}
                    onSort={(key) => toggleSort(posSort, setPosSort, key)}
                    renderCell={(row, key) => key === 'total' ? formatCurrency(row[key]) : row[key]}
                  />
                  </div>
                  <PaginationControls page={posPage} setPage={setPosPage} total={sortedPos.length} pageSize={posPageSize} setPageSize={setPosPageSize} />
                  </div>
                </Card>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5">
                <div className="animate-in-up">
                <Card padding={false} className="h-[390px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Top Selling Products" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-hidden">
                  <PerformanceList rows={topProductRows} primaryKey="product" midKey="quantity_sold" midLabel="sold" />
                  </div>
                  {topProducts.length > 0 && (
                    <PaginationControls page={topProductsPage} setPage={setTopProductsPage} total={topProducts.length} pageSize={topProductsPageSize} setPageSize={setTopProductsPageSize} />
                  )}
                  </div>
                </Card>
                </div>
                <div className="animate-in-up">
                <Card padding={false} className="h-[390px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Top Booked Packages" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-hidden">
                  <PerformanceList rows={topPackageRows} primaryKey="package" midKey="total_bookings" midLabel="bookings" />
                  </div>
                  {topPackages.length > 0 && (
                    <PaginationControls page={topPackagesPage} setPage={setTopPackagesPage} total={topPackages.length} pageSize={topPackagesPageSize} setPageSize={setTopPackagesPageSize} />
                  )}
                  </div>
                </Card>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="w-full space-y-4 animate-in-up" key="calendar">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-gold-dark font-black mb-1">Live Scheduling</p>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Booking Calendar</h1>
                  <p className="text-xs text-espresso/55 mt-1">Manage studio availability, studio sessions, and off-site event photoshoots.</p>
                </div>
                <div className="inline-flex rounded-[20px] border border-espresso/10 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setBookingCalendarMonth(month => shiftMonthValue(month, -1))}
                    className="rounded-2xl px-3 py-2 text-xs font-black text-espresso hover:bg-cream"
                  >
                    <ChevronLeft className="h-4 w-4 sm:hidden" aria-hidden="true" />
                    <span className="hidden sm:inline">Previous</span>
                  </button>
                  <div className="min-w-[160px] px-4 py-2 text-center text-sm font-black text-espresso">
                    {getMonthLabel(bookingCalendarMonth)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBookingCalendarMonth(month => shiftMonthValue(month, 1))}
                    className="rounded-2xl px-3 py-2 text-xs font-black text-espresso hover:bg-cream"
                  >
                    <ChevronRight className="h-4 w-4 sm:hidden" aria-hidden="true" />
                    <span className="hidden sm:inline">Next</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.65fr] gap-4 items-start">
                <div className="rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
                  <div className="mb-2 hidden grid-cols-7 gap-1.5 text-center text-[10px] font-black uppercase tracking-wider text-espresso/40 sm:grid">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}
                  </div>
                  <div className="grid hidden grid-cols-7 gap-1.5 sm:grid">
                    {calendarDays.map(day => {
                      if (day.blank) return <span key={day.key} />;
                      const dayBookings = bookingsByDate[day.date] || [];
                      const manualBlock = unavailableByDate[day.date];
                      const eventBlocked = eventBlockedDates.has(day.date);
                      const studioUnavailable = manualBlock || eventBlocked;
                      return (
                        <div
                          key={day.date}
                          className={`min-h-28 rounded-2xl border p-2 text-left transition-colors ${
                            studioUnavailable
                              ? 'border-amber-200 bg-amber-50'
                              : dayBookings.length
                              ? 'border-emerald-200 bg-emerald-50/70'
                              : 'border-espresso/10 bg-cream/30'
                          }`}
                          title={manualBlock?.reason || (eventBlocked ? 'Unavailable due to an event photoshoot.' : day.date)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-espresso">{day.day}</span>
                            {studioUnavailable && (
                              <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[8px] font-black text-amber-800">
                                Studio Off
                              </span>
                            )}
                          </div>
                          {studioUnavailable && (
                            <p className="mt-1 line-clamp-2 text-[9px] font-bold leading-tight text-amber-800">
                              {manualBlock?.reason || 'Unavailable due to an event photoshoot.'}
                            </p>
                          )}
                          <div className="mt-2 space-y-1">
                            {dayBookings.slice(0, 3).map(booking => (
                              <div
                                key={booking.id}
                                className={`rounded-lg px-2 py-1 text-[9px] font-black leading-tight ${
                                  isEventBooking(booking)
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-white text-espresso'
                                }`}
                              >
                                {isEventBooking(booking) ? 'Event' : 'Studio'} {String(booking.scheduled_time || '').slice(0, 5)}
                              </div>
                            ))}
                            {dayBookings.length > 3 && (
                              <p className="text-[9px] font-black text-espresso/45">+{dayBookings.length - 3} more</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-2 sm:hidden">
                    {calendarDays.filter(day => !day.blank).map(day => {
                      const dayBookings = bookingsByDate[day.date] || [];
                      const manualBlock = unavailableByDate[day.date];
                      const eventBlocked = eventBlockedDates.has(day.date);
                      const studioUnavailable = manualBlock || eventBlocked;
                      return (
                        <div
                          key={day.date}
                          className={`rounded-xl border p-3 ${
                            studioUnavailable
                              ? 'border-amber-200 bg-amber-50'
                              : dayBookings.length
                              ? 'border-emerald-200 bg-emerald-50/70'
                              : 'border-espresso/10 bg-cream/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-black text-espresso">{getCalendarDayLabel(day.date)}</p>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${
                              studioUnavailable
                                ? 'bg-amber-200 text-amber-800'
                                : dayBookings.length
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-white text-espresso/45'
                            }`}>
                              {studioUnavailable ? 'Studio Off' : dayBookings.length ? `${dayBookings.length} booking${dayBookings.length === 1 ? '' : 's'}` : 'Available'}
                            </span>
                          </div>
                          {studioUnavailable && (
                            <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
                              {manualBlock?.reason || 'Unavailable due to an event photoshoot.'}
                            </p>
                          )}
                          {dayBookings.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {dayBookings.map(booking => (
                                <span
                                  key={booking.id}
                                  className={`rounded-lg px-2 py-1 text-[10px] font-black ${
                                    isEventBooking(booking) ? 'bg-blue-100 text-blue-800' : 'bg-white text-espresso'
                                  }`}
                                >
                                  {isEventBooking(booking) ? 'Event' : 'Studio'} {String(booking.scheduled_time || '').slice(0, 5)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <form onSubmit={handleCreateStudioUnavailable} className="rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm space-y-3">
                    <CardHeader title="Studio Unavailable" subtitle="Block all Studio Session slots for one date." className="mb-1" />
                    <Input
                      label="Date"
                      type="date"
                      value={studioUnavailableDate}
                      onChange={e => {
                        setStudioUnavailableDate(e.target.value);
                        if (e.target.value) setBookingCalendarMonth(e.target.value.slice(0, 7));
                      }}
                    />
                    <Textarea
                      label="Reason"
                      rows={3}
                      value={studioUnavailableReason}
                      onChange={e => setStudioUnavailableReason(e.target.value)}
                      placeholder="Maintenance, private studio use, equipment setup..."
                    />
                    {studioCalendarError && <p className="text-[11px] font-bold text-red-600">{studioCalendarError}</p>}
                    <Button type="submit" variant="primary" icon={Calendar} loading={studioUnavailableSaving} disabled={studioUnavailableSaving}>
                      Mark Studio Unavailable
                    </Button>
                  </form>

                  <div className="rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
                    <CardHeader title="Manual Blocks" subtitle="Admin-created studio unavailable dates." className="mb-3" />
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {studioUnavailableDates.length ? studioUnavailableDates.map(row => (
                        <div key={row.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-black text-espresso">{row.date}</p>
                              <p className="mt-1 font-bold text-amber-800">{row.reason}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteStudioUnavailable(row)}
                              className="rounded-lg p-1.5 text-amber-700 hover:bg-amber-100 hover:text-red-700"
                              aria-label={`Remove studio block for ${row.date}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )) : (
                        <EmptyState icon={Calendar} title="No studio blocks" description="Manual unavailable dates for this month will appear here." />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
                <CardHeader title="Live Bookings" subtitle="Studio sessions and off-site event photoshoots for this month." className="mb-3" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {calendarMonthBookings.length ? calendarMonthBookings.map(booking => (
                    <div key={booking.id} className="rounded-2xl border border-espresso/10 bg-cream/40 p-3 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${isEventBooking(booking) ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {isEventBooking(booking) ? 'Off-site Event' : 'Studio Session'}
                            </span>
                            <StatusBadge status={booking.status} />
                          </div>
                          <p className="mt-2 font-black text-espresso">{booking.package_details?.name || 'Booking'} #{booking.id}</p>
                          <p className="mt-1 font-bold text-espresso/65">{getCalendarBookingName(booking)}</p>
                          <p className="mt-1 font-bold text-espresso/55">{booking.scheduled_date} at {String(booking.scheduled_time || '').slice(0, 5)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteBooking({ ...booking, customer_name: getCalendarBookingName(booking) })}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                          aria-label={`Delete booking ${booking.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <label className="mt-3 block">
                        <span className="sr-only">Booking status</span>
                        <select
                          value={booking.status}
                          onChange={e => handleCalendarBookingStatus(booking, e.target.value)}
                          className="w-full rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-bold text-espresso focus:outline-none focus:ring-4 focus:ring-gold/15"
                        >
                          {calendarBookingStatusOptions.map(option => (
                            <option key={option} value={option}>{option.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )) : (
                    <EmptyState icon={Calendar} title="No bookings this month" description="Studio and event bookings will appear here as they are created." />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* END-OF-DAY REPORTS */}
          {activeTab === 'reports' && (
            <div className="flex h-full min-h-0 w-full flex-col gap-4 animate-in-up" key="reports">
              <div className="shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">End-of-Day Reports</h1>
                  <p className="text-xs text-espresso/50 mt-1">Print shift closeout reports and reprint saved records.</p>
                </div>
                <Button variant="gold" size="sm" icon={Printer} onClick={() => openEndOfDayModal()}>
                  Prepare Closeout Report
                </Button>
              </div>

              <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  ['Saved Reports', endOfDayReports.length, 'bg-white text-espresso border-espresso/[0.06]'],
                  ['Last Gross Sales', endOfDayReports[0] ? formatCurrency(endOfDayReports[0].gross_sales) : formatCurrency(0), 'bg-emerald-50 text-emerald-700 border-emerald-200'],
                  ['Last Cash Difference', endOfDayReports[0] ? formatCurrency(endOfDayReports[0].cash_difference) : formatCurrency(0), 'bg-amber-50 text-amber-700 border-amber-200'],
                ].map(([label, value, className]) => (
                  <div key={label} className={`rounded-2xl border p-4 shadow-sm ${className}`}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-80">{label}</p>
                    <p className="text-2xl font-black mt-2">{value}</p>
                  </div>
                ))}
              </div>

              <Card padding={false} className="min-h-0 flex-1 overflow-hidden">
                <div className="flex h-full min-h-0 flex-col p-4 md:p-5">
                <CardHeader title="Saved Shift Closeouts" subtitle="Permanent reports for admin viewing and receipt reprinting." className="mb-4" />
                {endOfDayReports.length > 0 ? (
                  <>
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
                    {reportPageRows.map(report => (
                      <div key={report.id} className="rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-espresso">{report.report_date}</p>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${Number(report.cash_difference) === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                              Cash Diff {formatCurrency(report.cash_difference)}
                            </span>
                            {report.printed_at && (
                              <span className="rounded-full bg-cream px-2.5 py-1 text-[10px] font-black text-espresso/55">
                                Printed {formatManilaDateTime(report.printed_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-espresso/55 mt-1">
                            Closed by {report.staff_name || report.closed_by_name || 'Admin'} · {report.total_transactions} transactions · Gross {formatCurrency(report.gross_sales)}
                          </p>
                          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-bold text-espresso/65">
                            <span>Cash {formatCurrency(report.cash_sales)}</span>
                            <span>GCash {formatCurrency(report.gcash_sales)}</span>
                            <span>Booking {formatCurrency(report.booking_income)}</span>
                            <span>Items {report.total_items_sold || 0}</span>
                          </div>
                          {(report.first_transaction_id || report.last_transaction_id) && (
                            <p className="mt-2 text-[10px] font-black text-gold-dark">
                              {report.first_transaction_id === report.last_transaction_id
                                ? report.first_transaction_id
                                : `${report.first_transaction_id} to ${report.last_transaction_id}`}
                            </p>
                          )}
                        </div>
                        <Button variant="outline" size="sm" icon={Printer} onClick={() => handleReprintEndOfDayReport(report)}>
                          Reprint Closeout
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="shrink-0 sticky bottom-0 bg-white/95 pt-1">
                    <PaginationControls page={reportsPage} setPage={setReportsPage} total={endOfDayReports.length} pageSize={reportsPageSize} setPageSize={setReportsPageSize} />
                  </div>
                  </>
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <EmptyState icon={Printer} title="No end-of-day reports" description="Print the first closeout report from this admin page." />
                  </div>
                )}
                </div>
              </Card>
            </div>
          )}

          {/* PAYMENT BOOKING VERIFICATION */}
          {activeTab === 'payments' && (
            <div className="w-full space-y-4 animate-in-up" key="payments">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  ['Pending Verification', paymentStatusCounts.PENDING_VERIFICATION || 0, 'bg-amber-50 text-amber-700 border-amber-200'],
                  ['Approved', paymentStatusCounts.APPROVED || 0, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
                  ['Rejected', paymentStatusCounts.REJECTED || 0, 'bg-red-50 text-red-700 border-red-200'],
                ].map(([label, value, className]) => (
                  <div key={label} className={`rounded-2xl border p-4 shadow-sm ${className}`}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-80">{label}</p>
                    <p className="text-3xl font-black mt-2">{value}</p>
                  </div>
                ))}
              </div>

              <Card className="!p-4 md:!p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <CardHeader
                    title="GCash Payment Booking Verification"
                    subtitle="Approve only after matching the reference, amount, date/time, and screenshot in the GCash merchant app."
                    className="mb-0"
                  />
                  <div className="w-full md:w-64">
                    <Select
                      label="Filter Status"
                      value={paymentStatusFilter}
                      onChange={e => {
                        setPaymentStatusFilter(e.target.value);
                        setPaymentPage(1);
                      }}
                      options={[
                        { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
                        { value: 'APPROVED', label: 'Approved' },
                        { value: 'REJECTED', label: 'Rejected' },
                        { value: 'ALL', label: 'All Payments' },
                      ]}
                    />
                  </div>
                </div>

                {filteredBookingPayments.length > 0 ? (
                  <>
                  <div className="space-y-2.5">
                    {paymentPageRows.map((payment, i) => {
                      const details = payment.booking_details || {};
                      const isPending = payment.status === 'PENDING_VERIFICATION';
                      return (
                        <div key={payment.id} className="rounded-3xl border border-espresso/[0.06] bg-white/80 p-4 md:p-5 shadow-sm animate-in-up" style={{ animationDelay: `${i * 35}ms` }}>
                          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr_auto] gap-4 items-start">
                            <div className="space-y-3 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Avatar user={{ username: details.customer_name, email: details.customer_email, profile_picture_url: details.customer_profile_picture_url }} size="sm" />
                                <p className="font-black text-espresso">{details.customer_name || 'N/A'}</p>
                                <StatusBadge status={payment.status} />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div>
                                  <p className="text-espresso/45 font-black uppercase tracking-wider">Package</p>
                                  <p className="font-bold text-espresso">{details.package_name || details.package_details?.name || 'N/A'}</p>
                                  <p className="text-espresso/50">{details.scheduled_date} at {details.scheduled_time}</p>
                                </div>
                                <div>
                                  <p className="text-espresso/45 font-black uppercase tracking-wider">Customer Email</p>
                                  <p className="truncate font-bold text-espresso">{details.customer_email || 'No email'}</p>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3">
                                <p className="text-espresso/45 font-black uppercase tracking-wider">Reference</p>
                                <p className="font-black text-espresso break-all">{payment.reference_number}</p>
                              </div>
                              <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3">
                                <p className="text-espresso/45 font-black uppercase tracking-wider">Amount Paid</p>
                                <p className="font-black text-gold-dark">{formatCurrency(payment.amount)}</p>
                              </div>
                              <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3">
                                <p className="text-espresso/45 font-black uppercase tracking-wider">Required DP</p>
                                <p className="font-black text-espresso">{formatCurrency(payment.required_down_payment)}</p>
                              </div>
                              <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3">
                                <p className="text-espresso/45 font-black uppercase tracking-wider">Paid At</p>
                                <p className="font-black text-espresso">{formatManilaDateTime(payment.paid_at)}</p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 min-w-44">
                              {payment.receipt_url && (
                                <a
                                  href={payment.receipt_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center gap-2 rounded-[20px] bg-white/80 border border-espresso/10 px-4 py-2 text-xs font-black text-espresso hover:bg-cream-dark transition-all"
                                >
                                  <Eye className="w-4 h-4" />
                                  Review Receipt Proof
                                </a>
                              )}
                              {isPending ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="success"
                                    icon={Check}
                                    loading={verifyingPaymentId === payment.id}
                                    onClick={() => handleVerifyBookingPayment(payment, 'APPROVED')}
                                  >
                                    Confirm Payment
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    icon={X}
                                    disabled={verifyingPaymentId === payment.id}
                                    onClick={() => handleVerifyBookingPayment(payment, 'REJECTED')}
                                  >
                                    Flag Payment Issue
                                  </Button>
                                </>
                              ) : (
                                <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3 text-xs text-espresso/60">
                                  <p className="font-black text-espresso">Verified by</p>
                                  <div className="mt-2 flex items-center gap-2">
                                    <Avatar user={payment.verified_by_details} size="xs" />
                                    <p>{payment.verified_by_details?.username || 'N/A'}</p>
                                  </div>
                                  <p>{payment.verified_at ? formatManilaDateTime(payment.verified_at) : 'No timestamp'}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <PaginationControls page={paymentPage} setPage={setPaymentPage} total={filteredBookingPayments.length} pageSize={paymentPageSize} setPageSize={setPaymentPageSize} />
                  </>
                ) : (
                  <EmptyState icon={CreditCard} title="No payments found" description="Submitted GCash booking payments will appear here for verification." />
                )}
              </Card>
            </div>
          )}

          {/* STAFF ACCOUNTS */}
          {activeTab === 'staff' && (
            <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(320px,0.36fr)_minmax(0,1fr)] items-stretch animate-in-up" key="staff">
              <div className="min-h-[540px]">
                <Card className="!p-4 md:!p-5 h-full flex flex-col">
                  <CardHeader title="Add Staff User" />
                  <form onSubmit={handleCreateStaff} className="flex min-h-0 flex-1 flex-col gap-4">
                    <Input
                      label="Username"
                      required
                      value={newUsername}
                      onChange={e => { setNewUsername(e.target.value); setNewStaffErrors(current => ({ ...current, username: '' })); }}
                      placeholder="username"
                      disabled={creatingStaff}
                      error={newStaffErrors.username}
                    />
                    <Input
                      label="Password"
                      type="password"
                      required
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setNewStaffErrors(current => ({ ...current, password: '' })); }}
                      placeholder="password"
                      disabled={creatingStaff}
                      error={newStaffErrors.password}
                    />
                    <PasswordStrength password={newPassword} />
                    <Input
                      label="Email"
                      type="email"
                      value={newEmail}
                      onChange={e => { setNewEmail(e.target.value); setNewStaffErrors(current => ({ ...current, email: '' })); }}
                      placeholder="staff@cav.com"
                      disabled={creatingStaff}
                      error={newStaffErrors.email}
                    />
                    <Select
                      label="Role"
                      value={newRole}
                      onChange={e => setNewRole(e.target.value)}
                      disabled={creatingStaff}
                      options={[
                        { value: 'STAFF', label: 'Regular Staff' },
                        { value: 'ADMIN', label: 'Super Administrator' },
                        { value: 'CUSTOMER', label: 'Customer Profile' },
                      ]}
                    />
                    <Button type="submit" variant="primary" className="mt-auto w-full" icon={Plus} loading={creatingStaff} disabled={creatingStaff || !newStaffFormValid}>
                      Create Staff Access
                    </Button>
                  </form>
                </Card>
              </div>

              <div className="min-h-[540px]">
                <Card className="!p-4 md:!p-5 h-full flex flex-col">
                  <CardHeader title="Existing Accounts" />
                  {staffList.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                    <DashboardTable
                      columns={[
                        {
                          key: 'username',
                          label: 'Username',
                          render: st => (
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <Avatar user={st} size="xs" />
                              <span className="min-w-0 truncate">{st.username}</span>
                            </span>
                          ),
                        },
                        { key: 'email', label: 'Email', render: st => st.email || 'N/A' },
                        { key: 'role', label: 'Role', render: st => <StatusBadge status={st.role} /> },
                      ]}
                      rows={staffPageRows}
                      sort={staffSort}
                      onSort={(key) => toggleSort(staffSort, setStaffSort, key)}
                      renderActions={st => (
                        <>
                          <Button
                            variant="ghost"
                            size="xs"
                            icon={Edit}
                            title={`Edit ${st.username}`}
                            aria-label={`Edit ${st.username}`}
                            onClick={() => openStaffEditModal(st)}
                          />
                          <Button
                            variant="ghost"
                            size="xs"
                            icon={Trash2}
                            title={`Delete ${st.username}`}
                            aria-label={`Delete ${st.username}`}
                            onClick={() => handleDeleteStaff(st)}
                            disabled={deletingStaffId === st.id || st.id === user?.id}
                            className="text-red-500 hover:text-red-700"
                          />
                        </>
                      )}
                      minWidth={680}
                    />
                    <PaginationControls page={staffPage} setPage={setStaffPage} total={staffList.length} pageSize={staffPageSize} setPageSize={setStaffPageSize} />
                    </div>
                  ) : (
                    <EmptyState icon={Users} title="No accounts found" description="Create your first staff account using the form." />
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* FAQ MANAGER */}
          {activeTab === 'faq' && (
            <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-12 items-start animate-in-up" key="faq">
              <div className="xl:col-span-4">
                <Card className="!p-4 md:!p-5">
                  <CardHeader title={editingFaq ? 'Update FAQ Entry' : 'Add FAQ Entry'} />
                  <form onSubmit={handleFAQSubmit} className="space-y-4">
                    <Input
                      label="Question"
                      required
                      value={faqQuestion}
                      onChange={e => { setFaqQuestion(e.target.value); setFaqErrors(current => ({ ...current, question: '' })); }}
                      placeholder="e.g. Do you accept credit cards?"
                      disabled={faqSaving}
                      error={faqErrors.question}
                    />
                    <Textarea
                      label="Answer"
                      required
                      value={faqAnswer}
                      onChange={e => { setFaqAnswer(e.target.value); setFaqErrors(current => ({ ...current, answer: '' })); }}
                      placeholder="e.g. Yes! We accept Mastercard, Visa, and GCash."
                      rows={4}
                      disabled={faqSaving}
                      error={faqErrors.answer}
                    />
                    <Input label="Tags / Keywords" value={faqTags} onChange={e => setFaqTags(e.target.value)} placeholder="e.g. card, payment, visa" disabled={faqSaving} />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" className="flex-1" icon={Check} loading={faqSaving} disabled={faqSaving || !faqFormValid}>
                        Publish FAQ Answer
                      </Button>
                      {editingFaq && (
                        <Button variant="outline" onClick={() => { setFaqQuestion(''); setFaqAnswer(''); setFaqTags(''); setEditingFaq(null); setFaqErrors({}); }} disabled={faqSaving}>
                          Keep Current FAQ
                        </Button>
                      )}
                    </div>
                  </form>
                </Card>
              </div>

              <div className="xl:col-span-8">
                <Card className="!p-4 md:!p-5">
                  <CardHeader title="Knowledge Base FAQs" subtitle="RAG-powered question bank" />
                  {faqs.length > 0 ? (
                    <>
                    <div className="space-y-2.5">
                      {faqPageRows.map((faq, i) => (
                        <div key={faq.id} className="bg-cream p-4 md:p-5 rounded-2xl border border-espresso/5 flex justify-between items-start gap-4 animate-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <p className="font-bold text-sm text-espresso">{faq.question}</p>
                            <p className="text-xs text-espresso/60 leading-relaxed">{faq.answer}</p>
                            {faq.tags && (
                              <p className="text-[10px] text-gold-dark font-semibold">Keywords: {faq.tags}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Edit}
                              onClick={() => { setEditingFaq(faq); setFaqQuestion(faq.question); setFaqAnswer(faq.answer); setFaqTags(faq.tags || ''); setFaqErrors({}); }}
                            />
                            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDeleteFAQ(faq.id)} loading={deletingFaqId === faq.id} disabled={deletingFaqId === faq.id} className="text-red-500 hover:text-red-700" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <PaginationControls page={faqPage} setPage={setFaqPage} total={faqs.length} pageSize={faqPageSize} setPageSize={setFaqPageSize} />
                    </>
                  ) : (
                    <EmptyState icon={MessageSquare} title="No FAQs yet" description="Add your first FAQ entry to power the chatbot." />
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* SYSTEM CONTROLS */}
          {activeTab === 'system' && (
            <div className="w-full max-w-5xl space-y-4 animate-in-up" key="system">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-gold-dark font-black mb-1">Protected Admin Action</p>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">System Controls</h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-espresso/55">
                  Reset operational records for a clean system state while keeping the business catalog intact.
                </p>
              </div>

              <Card className="!p-4 md:!p-6 border-red-200/80 bg-red-50/45">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-700">
                      <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div>
                        <h2 className="text-lg font-black text-espresso">Reset System Data</h2>
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-espresso/62">
                          This deletes transactional and user-generated database records. It cannot be undone from the dashboard.
                        </p>
                      </div>
                      <div className="grid gap-3 text-xs md:grid-cols-2">
                        <div className="rounded-2xl border border-emerald-200 bg-white/80 p-4">
                          <p className="mb-2 font-black uppercase tracking-[0.14em] text-emerald-700">Preserved</p>
                          <p className="leading-relaxed text-espresso/65">Admin accounts, menu products, services, packages, inventory catalog, stock levels, recipes, FAQs, and gallery records.</p>
                        </div>
                        <div className="rounded-2xl border border-red-200 bg-white/80 p-4">
                          <p className="mb-2 font-black uppercase tracking-[0.14em] text-red-700">Deleted</p>
                          <p className="leading-relaxed text-espresso/65">Bookings, booking payments, POS orders/payments, reports, forecasts, sales summaries, stock movement history, purchase orders, notifications, chatbot logs, reset OTPs, old audit logs, and non-admin users.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    icon={Trash2}
                    onClick={openSystemResetModal}
                    className="w-full shrink-0 lg:w-auto"
                  >
                    Reset System Data
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>

      <Modal
        open={systemResetOpen}
        onClose={closeSystemResetModal}
        title="Confirm System Reset"
        size="lg"
      >
        <form onSubmit={handleSystemReset} className="space-y-5">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <p className="font-black">This action permanently resets operational data.</p>
                <p className="text-xs leading-relaxed text-red-700/85">
                  Menu items, packages, inventory catalog, stock levels, recipes, FAQs, gallery records, and admin accounts are preserved.
                </p>
              </div>
            </div>
          </div>

          {systemResetError && (
            <div className="rounded-2xl border border-red-200 bg-white p-3 text-xs font-semibold text-red-700">
              {systemResetError}
            </div>
          )}

          <Input
            label="Admin Password"
            type="password"
            value={systemResetPassword}
            onChange={e => setSystemResetPassword(e.target.value)}
            placeholder="Enter your admin password"
            required
            disabled={systemResetLoading}
          />

          <div className="space-y-2">
            <Input
              label="Confirmation"
              value={systemResetConfirmation}
              onChange={e => setSystemResetConfirmation(e.target.value)}
              placeholder="RESET SYSTEM DATA"
              required
              disabled={systemResetLoading}
            />
            <p className="text-[11px] font-semibold leading-relaxed text-espresso/50">
              Type <span className="font-black text-espresso">RESET SYSTEM DATA</span> exactly to enable the reset.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={closeSystemResetModal}
              disabled={systemResetLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              icon={Trash2}
              loading={systemResetLoading}
              disabled={!systemResetPassword || systemResetConfirmation !== 'RESET SYSTEM DATA'}
            >
              Reset System Data
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editingStaff}
        onClose={() => {
          if (staffSaving) return;
          setEditingStaff(null);
          setEditStaffErrors({});
        }}
        title="Edit Staff Account"
        size="md"
      >
        <form onSubmit={handleUpdateStaff} className="space-y-4">
          <Input
            label="Username"
            required
            value={editStaffForm.username}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, username: e.target.value }));
              setEditStaffErrors(current => ({ ...current, username: '' }));
            }}
            disabled={staffSaving}
            error={editStaffErrors.username}
          />
          <Input
            label="Email"
            type="email"
            value={editStaffForm.email}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, email: e.target.value }));
              setEditStaffErrors(current => ({ ...current, email: '' }));
            }}
            disabled={staffSaving}
            error={editStaffErrors.email}
          />
          <Input
            label="New Password"
            type="password"
            value={editStaffForm.password}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, password: e.target.value }));
              setEditStaffErrors(current => ({ ...current, password: '' }));
            }}
            placeholder="Leave blank to keep current password"
            disabled={staffSaving}
            error={editStaffErrors.password}
          />
          {editStaffForm.password && <PasswordStrength password={editStaffForm.password} />}
          <Select
            label="Role"
            value={editStaffForm.role}
            onChange={e => setEditStaffForm(current => ({ ...current, role: e.target.value }))}
            disabled={staffSaving}
            options={[
              { value: 'STAFF', label: 'Regular Staff' },
              { value: 'ADMIN', label: 'Super Administrator' },
              { value: 'CUSTOMER', label: 'Customer Profile' },
            ]}
          />
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" loading={staffSaving} disabled={staffSaving || !editStaffFormValid} icon={Check}>
              Update Account
            </Button>
            <Button type="button" variant="outline" onClick={() => { setEditingStaff(null); setEditStaffErrors({}); }} disabled={staffSaving}>
              Keep Current Details
            </Button>
          </div>
        </form>
      </Modal>

      {/* End-of-Day Report Modal */}
      <Modal open={endOfDayModalOpen} onClose={() => !endOfDayPrinting && setEndOfDayModalOpen(false)} title="Print End-of-Day Report" size="sm">
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-espresso/60">
            Opening cash and cash movement update the closing cash automatically. The system will save the report and send it to the 58mm receipt printer.
          </p>
          <Input
            label="Report Date"
            type="date"
            value={endOfDayDate}
            onChange={e => handleEndOfDayDateChange(e.target.value)}
            disabled={endOfDayPrinting}
          />
          <Input
            label="Opening Cash"
            type="number"
            min="0"
            step="0.01"
            value={endOfDayOpeningCash}
            onChange={e => {
              const value = e.target.value;
              const expectedCash = getEndOfDayExpectedCashValue(value, endOfDayCashSales, endOfDayCashInOut).toFixed(2);
              setEndOfDayOpeningCash(value);
              setEndOfDayExpectedCash(expectedCash);
              setEndOfDayActualCash(expectedCash);
            }}
            placeholder="0.00"
            disabled={endOfDayPrinting || endOfDayCashLoading}
          />
          <Input
            label="Cash In/Out"
            type="number"
            step="0.01"
            value={endOfDayCashInOut}
            onChange={e => {
              const value = e.target.value;
              const expectedCash = getEndOfDayExpectedCashValue(endOfDayOpeningCash, endOfDayCashSales, value).toFixed(2);
              setEndOfDayCashInOut(value);
              setEndOfDayExpectedCash(expectedCash);
              setEndOfDayActualCash(expectedCash);
            }}
            placeholder="0.00"
            disabled={endOfDayPrinting || endOfDayCashLoading}
          />
          <Input
            label="Closing Cash / Actual Cash"
            type="number"
            min="0"
            step="0.01"
            value={endOfDayActualCash}
            onChange={e => setEndOfDayActualCash(e.target.value)}
            placeholder="0.00"
            disabled={endOfDayPrinting || endOfDayCashLoading}
          />
          <div className="rounded-2xl border border-espresso/10 bg-cream/70 p-3 text-[11px] font-bold leading-relaxed text-espresso/65">
            Auto-filled cash sales: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayCashSales || 0)}. Expected cash: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(displayedEndOfDayExpectedCash || 0)}.
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">
            Confirm before printing. This creates a permanent saved report for future viewing and reprinting.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="gold" className="flex-1" icon={Printer} onClick={handlePrintEndOfDayReport} loading={endOfDayPrinting}>
              Print & Save Report
            </Button>
            <Button variant="outline" onClick={() => setEndOfDayModalOpen(false)} disabled={endOfDayPrinting}>
              Keep Report Draft
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
