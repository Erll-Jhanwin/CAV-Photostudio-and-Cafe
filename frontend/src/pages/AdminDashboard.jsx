import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import {
  TrendingUp, BarChart2, Users, MessageSquare, Play, Package,
  AlertTriangle, DollarSign, LogOut, Check, Plus, Trash2, Edit,
  Menu, X, Calendar, CreditCard, ClipboardCheck, ShoppingBag, ArrowUpRight,
  ArrowDownRight, Eye, ChevronLeft, ChevronRight, Coffee, Camera
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, ComposedChart
} from 'recharts';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonChart, SkeletonStatsCard, SkeletonTable, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import { MobileHeader } from '../components/ui/MobileHeader';

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

const formatDateValue = (date) => date.toISOString().split('T')[0];

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

function DashboardTable({ columns, rows, sort, onSort, renderCell, renderActions }) {
  if (!rows?.length) {
    return <EmptyState icon={BarChart2} title="No records found" description="No data exists for the selected date range." />;
  }
  return (
    <div className="overflow-x-auto -mx-5 md:-mx-6">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-espresso/[0.06] text-espresso/45 uppercase tracking-wider">
            {columns.map(([key, label]) => (
              <th key={key} className="px-5 py-2.5 text-left">
                <button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 font-black hover:text-espresso focus-visible:outline-gold">
                  {label}
                  {sort.key === key && <span>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </th>
            ))}
            <th className="px-5 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-espresso/[0.04] hover:bg-cream/45 transition-colors">
              {columns.map(([key]) => (
                <td key={key} className="px-5 py-3 font-semibold text-espresso/75 whitespace-nowrap">
                  {renderCell(row, key)}
                </td>
              ))}
              <td className="px-5 py-3 text-right">
                {renderActions ? renderActions(row) : (
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-cream px-3 py-1.5 text-[10px] font-black text-espresso hover:bg-gold transition-all">
                    <Eye className="w-3 h-3" />
                    View
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablePager({ page, setPage, total, pageSize }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <div className="flex items-center justify-between mt-4 text-xs text-espresso/55">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="p-2 rounded-xl bg-cream disabled:opacity-40 hover:bg-cream-dark transition-colors" aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} className="p-2 rounded-xl bg-cream disabled:opacity-40 hover:bg-cream-dark transition-colors" aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
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
  const [activeTab, setActiveTab] = useState('analytics');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [analytics, setAnalytics] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [bookingPayments, setBookingPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [faqTags, setFaqTags] = useState('');
  const [editingFaq, setEditingFaq] = useState(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('STAFF');

  const [retrainLoading, setRetrainLoading] = useState(false);
  const [datePreset, setDatePreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [chartGrain, setChartGrain] = useState('daily');
  const [visibleSeries, setVisibleSeries] = useState({
    pos_revenue: true,
    booking_revenue: true,
    total_revenue: true,
  });
  const [bookingPage, setBookingPage] = useState(1);
  const [posPage, setPosPage] = useState(1);
  const [bookingSort, setBookingSort] = useState({ key: 'created_at', dir: 'desc' });
  const [posSort, setPosSort] = useState({ key: 'date', dir: 'desc' });
  const [deletingBookingId, setDeletingBookingId] = useState(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('PENDING_VERIFICATION');
  const [verifyingPaymentId, setVerifyingPaymentId] = useState(null);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, datePreset, customStart, customEnd, chartGrain]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const range = getRangeDates(datePreset, customStart, customEnd);
      const [analyticsRes, forecastRes, staffRes, faqRes, paymentsRes] = await Promise.all([
        client.get('/api/dashboard/analytics/', { params: { ...range, grain: chartGrain } }),
        client.get('/api/forecasting/predictions/'),
        client.get('/api/auth/users/'),
        client.get('/api/chatbot/faqs/'),
        client.get('/api/bookings/payments/')
      ]);
      setAnalytics(analyticsRes.data);
      setForecast(forecastRes.data);
      setStaffList(staffRes.data);
      setFaqs(faqRes.data);
      setBookingPayments(paymentsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    try {
      await client.post('/api/auth/users/', {
        username: newUsername, password: newPassword,
        email: newEmail, role: newRole
      });
      setNewUsername(''); setNewPassword(''); setNewEmail(''); setNewRole('STAFF');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create staff account.');
    }
  };

  const handleFAQSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingFaq) {
        await client.put(`/api/chatbot/faqs/${editingFaq.id}/`, {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
      } else {
        await client.post('/api/chatbot/faqs/', {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
      }
      setFaqQuestion(''); setFaqAnswer(''); setFaqTags(''); setEditingFaq(null);
      fetchData();
    } catch {
      alert('Failed to save FAQ.');
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
    if (!window.confirm('Delete this FAQ?')) return;
    try {
      await client.delete(`/api/chatbot/faqs/${id}/`);
      fetchData();
    } catch { /* ignore */ }
  };

  const handleDeleteBooking = async (booking) => {
    if (!window.confirm(`Delete booking #${booking.id} for ${booking.customer_name}?`)) return;
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
        return {
          ...current,
          metrics,
          recent_bookings: (current.recent_bookings || []).filter(row => row.id !== booking.id),
        };
      });
      setBookingPage(page => Math.max(1, Math.min(page, Math.ceil((sortedBookings.length - 1) / tablePageSize) || 1)));
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete booking.');
    } finally {
      setDeletingBookingId(null);
    }
  };

  const handleVerifyBookingPayment = async (payment, newStatus) => {
    const action = newStatus === 'APPROVED' ? 'approve' : 'reject';
    if (!window.confirm(`Are you sure you want to ${action} payment ${payment.reference_number}?`)) return;
    try {
      setVerifyingPaymentId(payment.id);
      const res = await client.patch(`/api/bookings/payments/${payment.id}/verify/`, { status: newStatus });
      setBookingPayments(current => current.map(item => item.id === payment.id ? res.data : item));
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.status || 'Failed to verify payment.');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  const handleLogout = useCallback(() => { logout(); navigate('/login', { replace: true }); }, [logout, navigate]);

  if (loading) return <AdminSkeleton />;

  const navItems = [
    { key: 'forecast', label: 'ML Forecast Center', icon: TrendingUp, active: activeTab === 'forecast', onClick: () => setActiveTab('forecast') },
    { key: 'analytics', label: 'InsightHub Dashboard', icon: BarChart2, active: activeTab === 'analytics', onClick: () => setActiveTab('analytics') },
    { key: 'payments', label: 'Payment Verification', icon: CreditCard, active: activeTab === 'payments', onClick: () => setActiveTab('payments') },
    { key: 'staff', label: 'Staff Accounts', icon: Users, active: activeTab === 'staff', onClick: () => setActiveTab('staff') },
    { key: 'faq', label: 'Chatbot Manager', icon: MessageSquare, active: activeTab === 'faq', onClick: () => setActiveTab('faq') },
  ];

  const pageTitles = { forecast: 'ML Forecast Center', analytics: 'InsightHub Dashboard', payments: 'Payment Verification', staff: 'Staff Accounts', faq: 'Chatbot Manager' };
  const metrics = analytics?.metrics || {};
  const statusData = [
    { label: 'Pending', value: metrics.pending || 0, color: '#F59E0B' },
    { label: 'Confirmed', value: metrics.confirmed || 0, color: '#3B82F6' },
    { label: 'Completed', value: metrics.completed || 0, color: '#10B981' },
    { label: 'Cancelled', value: metrics.cancelled || 0, color: '#EF4444' },
  ];
  const revenueTotal = Number(metrics.pos_revenue || 0) + Number(metrics.booking_revenue || 0);
  const tablePageSize = 5;
  const sortRows = (rows, sort) => [...(rows || [])].sort((a, b) => {
    const av = a[sort.key] ?? '';
    const bv = b[sort.key] ?? '';
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
  const toggleSort = (current, setter, key) => {
    setter(current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const sortedBookings = sortRows(analytics?.recent_bookings, bookingSort);
  const sortedPos = sortRows(analytics?.recent_pos_transactions, posSort);
  const bookingPageRows = sortedBookings.slice((bookingPage - 1) * tablePageSize, bookingPage * tablePageSize);
  const posPageRows = sortedPos.slice((posPage - 1) * tablePageSize, posPage * tablePageSize);
  const inventoryCounts = analytics?.inventory_status_counts || {};
  const inventorySummary = Object.entries(inventoryStatusMeta).map(([key, meta]) => ({
    key,
    ...meta,
    value: inventoryCounts[key] || 0,
  }));
  const inventoryAlerts = analytics?.inventory_alerts || [];
  const filteredBookingPayments = bookingPayments.filter(payment => (
    paymentStatusFilter === 'ALL' || payment.status === paymentStatusFilter
  ));
  const paymentStatusCounts = bookingPayments.reduce((acc, payment) => {
    acc[payment.status] = (acc[payment.status] || 0) + 1;
    return acc;
  }, {});

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
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} />

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto scrollbar-thin">
          {/* FORECAST CENTER */}
          {activeTab === 'forecast' && (
            <div className="space-y-6 animate-in-up" key="forecast">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">ML Forecast Center</h1>
                  <p className="text-xs text-espresso/50 mt-1">Predictive sales forecasting using historical data modeling.</p>
                </div>
                <Button variant="primary" size="sm" loading={retrainLoading} icon={Play} onClick={handleRetrain}>
                  {retrainLoading ? 'Modeling...' : 'Retrain ML Engine'}
                </Button>
              </div>

              <Card>
                <CardHeader title="7-Day Projected Sales" subtitle="With confidence intervals (90% confidence)" />
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecast?.sales_forecast || []} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5ECE1" />
                      <XAxis dataKey="target_date" stroke="#2E1A11" fontSize={11} tickLine={false} />
                      <YAxis stroke="#2E1A11" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5ECE1' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="predicted_sales" name="Forecasted Sales" stroke="#D4AF37" strokeWidth={3} dot={{ r: 4, fill: '#D4AF37' }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="upper_bound" name="Upper Bound" stroke="#8D6E63" strokeDasharray="5 5" strokeWidth={1.5} />
                      <Line type="monotone" dataKey="lower_bound" name="Lower Bound" stroke="#E57373" strokeDasharray="5 5" strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8">
                  <Card>
                    <CardHeader title="Estimated Stock Depletions &amp; Reorders" subtitle="Based on 7-day demand forecast" />
                    <div className="overflow-x-auto -mx-6">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-espresso/5 text-espresso/50 font-bold uppercase tracking-wider">
                            <th className="p-4 text-left">Product</th>
                            <th className="p-4 text-center">Stock</th>
                            <th className="p-4 text-center">7-Day Demand</th>
                            <th className="p-4 text-center">Balance</th>
                            <th className="p-4 text-center">Order Qty</th>
                            <th className="p-4 text-left">Supplier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {forecast?.reorder_recommendations?.length > 0 ? forecast.reorder_recommendations.map((rec, i) => (
                            <tr key={i} className="border-b border-espressor/5 hover:bg-espresso/[0.02] transition-colors">
                              <td className="p-4 font-semibold text-espresso">{rec.product_name}</td>
                              <td className="p-4 text-center font-bold">{rec.current_stock}</td>
                              <td className="p-4 text-center font-bold text-gold-dark">{rec["7_day_forecasted_demand"]}</td>
                              <td className={`p-4 text-center font-bold ${rec.projected_stock <= 0 ? 'text-red-600' : 'text-espresso/60'}`}>
                                {rec.projected_stock}
                              </td>
                              <td className="p-4 text-center">
                                <span className="bg-amber-50 text-amber-700 font-bold px-2.5 py-1 rounded-lg text-[10px]">
                                  +{rec.recommended_order_quantity}
                                </span>
                              </td>
                              <td className="p-4 text-espresso/60">{rec.supplier_name}</td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={6}>
                                <EmptyState icon={Package} title="All stocks optimal" description="No reorder actions needed at this time." />
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>

                <div className="lg:col-span-4 space-y-6">
                  <Card>
                    <CardHeader title="Low Stock Alerts" />
                    {analytics?.low_stock_alerts?.length > 0 ? (
                      <div className="space-y-3">
                        {analytics.low_stock_alerts.map((alert, i) => (
                          <div key={i} className="bg-red-50/80 p-4 rounded-xl border border-red-100 flex justify-between items-start">
                            <div>
                              <p className="font-bold text-sm text-red-900">{alert.name}</p>
                              <p className="text-[10px] text-red-600 mt-0.5">Supplier: {alert.supplier_name}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-red-800">Stock: {alert.stock_quantity} {alert.base_unit}</p>
                              <p className="text-[10px] text-red-500">Min: {alert.minimum_stock_level}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon={AlertTriangle} title="No alerts" description="All stock levels are healthy." />
                    )}
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* INSIGHTHUB DASHBOARD */}
          {activeTab === 'analytics' && (
            <div className="max-w-[1680px] mx-auto space-y-4 md:space-y-5 animate-in-up" key="analytics">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-gold-dark font-black mb-1">CAV InsightHub</p>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Business Overview</h1>
                  <p className="text-xs text-espresso/55 mt-1">Real-time sales, bookings, POS activity, and performance insights.</p>
                </div>
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

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)] gap-4 md:gap-5">
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

                <Card padding={false}>
                  <div className="p-5">
                    <CardHeader title="Stock Action Alerts" className="mb-3" />
                    {inventoryAlerts.length > 0 ? (
                      <div className="space-y-2.5 max-h-72 overflow-y-auto scrollbar-thin pr-1">
                        {inventoryAlerts.map(alert => {
                          const meta = inventoryStatusMeta[alert.inventory_status] || inventoryStatusMeta.IN_STOCK;
                          return (
                            <div key={alert.id} className="rounded-2xl bg-white border border-espresso/[0.06] p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-black text-sm text-espresso truncate">{alert.name}</p>
                                  <p className="text-[10px] text-espresso/45">{alert.stock_quantity} {alert.base_unit} · Min {alert.minimum_stock_level}</p>
                                </div>
                                <span className={`shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.className}`}>
                                  {meta.label}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                                <span className="font-bold text-gold-dark">{alert.suggested_action}</span>
                                <span className="text-espresso/45">{alert.supplier_name}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState icon={Package} title="Stock is healthy" description="No ingredient actions are needed right now." />
                    )}
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.75fr)_minmax(360px,0.8fr)] gap-4 md:gap-5 items-stretch">
              <div className="animate-in-up">
              <Card className="rounded-[24px] h-full" padding={false}>
                <div className="p-5 md:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
                  <CardHeader title="Sales Analytics" subtitle="POS sales, booking revenue, and combined revenue" className="p-0" />
                  <div className="flex flex-wrap gap-2">
                    {['daily', 'weekly', 'monthly'].map(grain => (
                      <button key={grain} onClick={() => setChartGrain(grain)} className={`px-3 py-2 rounded-2xl text-[11px] font-black capitalize transition-all ${chartGrain === grain ? 'bg-espresso text-gold' : 'bg-cream text-espresso/60 hover:text-espresso'}`}>
                        {grain}
                      </button>
                    ))}
                    {[
                      ['pos_revenue', 'POS'],
                      ['booking_revenue', 'Bookings'],
                      ['total_revenue', 'Combined'],
                    ].map(([key, label]) => (
                      <button key={key} onClick={() => setVisibleSeries(v => ({ ...v, [key]: !v[key] }))} className={`px-3 py-2 rounded-2xl text-[11px] font-black transition-all ${visibleSeries[key] ? 'bg-gold text-espresso' : 'bg-cream text-espresso/45'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-[300px] 2xl:h-[360px] w-full">
                  {analytics?.sales_history_chart?.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={analytics.sales_history_chart} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5ECE1" />
                        <XAxis dataKey="date" stroke="#2E1A11" fontSize={10} tickLine={false} />
                        <YAxis stroke="#2E1A11" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: 16, border: '1px solid rgba(46,26,17,0.08)' }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {visibleSeries.pos_revenue && <Bar dataKey="pos_revenue" name="POS Sales" fill="#8D6E63" radius={[8, 8, 0, 0]} />}
                        {visibleSeries.booking_revenue && <Bar dataKey="booking_revenue" name="Booking Revenue" fill="#D4AF37" radius={[8, 8, 0, 0]} />}
                        {visibleSeries.total_revenue && <Line type="monotone" dataKey="total_revenue" name="Combined Revenue" stroke="#2E1A11" strokeWidth={3} dot={false} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState icon={BarChart2} title="No sales data" description="No completed revenue exists for this date range." />
                  )}
                </div>
                </div>
              </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-1 gap-4 md:gap-5">
                <div className="animate-in-up">
                <Card className="h-full" padding={false}>
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
                </div>
                <div className="animate-in-up">
                <Card className="h-full" padding={false}>
                  <div className="p-5">
                  <CardHeader title="Booking Status Summary" className="mb-3" />
                  <div className="grid grid-cols-[130px_1fr] gap-4 items-center">
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={38} outerRadius={58} paddingAngle={3}>
                            {statusData.map(s => <Cell key={s.label} fill={s.color} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3">
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
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 md:gap-5">
                <div className="animate-in-up">
                <Card padding={false} className="h-[430px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Recent Bookings" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <DashboardTable
                    columns={[
                      ['customer_name', 'Customer'],
                      ['package_name', 'Package'],
                      ['scheduled_date', 'Booking Date'],
                      ['status', 'Status'],
                      ['amount', 'Amount'],
                    ]}
                    rows={bookingPageRows}
                    sort={bookingSort}
                    onSort={(key) => toggleSort(bookingSort, setBookingSort, key)}
                    renderCell={(row, key) => key === 'amount' ? formatCurrency(row[key]) : key === 'status' ? <StatusBadge status={row[key]} /> : row[key]}
                    renderActions={(row) => (
                      <button
                        type="button"
                        onClick={() => handleDeleteBooking(row)}
                        disabled={deletingBookingId === row.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-1.5 text-[10px] font-black text-red-600 hover:bg-red-600 hover:text-white transition-all"
                        aria-label={`Delete booking #${row.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                        {deletingBookingId === row.id ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                  />
                  </div>
                  <TablePager page={bookingPage} setPage={setBookingPage} total={sortedBookings.length} pageSize={tablePageSize} />
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
                      ['id', 'Transaction ID'],
                      ['cashier', 'Cashier'],
                      ['date', 'Date'],
                      ['total', 'Total'],
                      ['payment_method', 'Payment Method'],
                    ]}
                    rows={posPageRows}
                    sort={posSort}
                    onSort={(key) => toggleSort(posSort, setPosSort, key)}
                    renderCell={(row, key) => key === 'id' ? `#${row[key]}` : key === 'total' ? formatCurrency(row[key]) : row[key]}
                  />
                  </div>
                  <TablePager page={posPage} setPage={setPosPage} total={sortedPos.length} pageSize={tablePageSize} />
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
                  <PerformanceList rows={analytics?.top_selling_products || []} primaryKey="product" midKey="quantity_sold" midLabel="sold" />
                  </div>
                  </div>
                </Card>
                </div>
                <div className="animate-in-up">
                <Card padding={false} className="h-[390px]">
                  <div className="p-5 md:p-6 h-full flex flex-col">
                  <CardHeader title="Top Booked Packages" className="mb-3" />
                  <div className="min-h-0 flex-1 overflow-hidden">
                  <PerformanceList rows={analytics?.top_booked_packages || []} primaryKey="package" midKey="total_bookings" midLabel="bookings" />
                  </div>
                  </div>
                </Card>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT VERIFICATION */}
          {activeTab === 'payments' && (
            <div className="max-w-[1480px] mx-auto space-y-6 animate-in-up" key="payments">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  ['Pending Verification', paymentStatusCounts.PENDING_VERIFICATION || 0, 'bg-amber-50 text-amber-700 border-amber-200'],
                  ['Approved', paymentStatusCounts.APPROVED || 0, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
                  ['Rejected', paymentStatusCounts.REJECTED || 0, 'bg-red-50 text-red-700 border-red-200'],
                ].map(([label, value, className]) => (
                  <div key={label} className={`rounded-3xl border p-5 shadow-sm ${className}`}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-80">{label}</p>
                    <p className="text-3xl font-black mt-2">{value}</p>
                  </div>
                ))}
              </div>

              <Card>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
                  <CardHeader
                    title="GCash Payment Verification"
                    subtitle="Approve only after matching the reference, amount, date/time, and screenshot in the GCash merchant app."
                    className="mb-0"
                  />
                  <div className="w-full md:w-64">
                    <Select
                      label="Filter Status"
                      value={paymentStatusFilter}
                      onChange={e => setPaymentStatusFilter(e.target.value)}
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
                  <div className="space-y-3 max-h-[680px] overflow-y-auto pr-1 scrollbar-thin">
                    {filteredBookingPayments.map((payment, i) => {
                      const details = payment.booking_details || {};
                      const isPending = payment.status === 'PENDING_VERIFICATION';
                      return (
                        <div key={payment.id} className="rounded-3xl border border-espresso/[0.06] bg-white/80 p-4 md:p-5 shadow-sm animate-in-up" style={{ animationDelay: `${i * 35}ms` }}>
                          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr_auto] gap-4 items-start">
                            <div className="space-y-3 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-black text-espresso">Booking #{details.id}</p>
                                <StatusBadge status={payment.status} />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div>
                                  <p className="text-espresso/45 font-black uppercase tracking-wider">Customer</p>
                                  <p className="font-bold text-espresso">{details.customer_name || 'N/A'}</p>
                                  <p className="text-espresso/50">{details.customer_email || 'No email'}</p>
                                </div>
                                <div>
                                  <p className="text-espresso/45 font-black uppercase tracking-wider">Package</p>
                                  <p className="font-bold text-espresso">{details.package_name || 'N/A'}</p>
                                  <p className="text-espresso/50">{details.scheduled_date} at {details.scheduled_time}</p>
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
                                <p className="font-black text-espresso">{new Date(payment.paid_at).toLocaleString()}</p>
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
                                  View Receipt
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
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    icon={X}
                                    disabled={verifyingPaymentId === payment.id}
                                    onClick={() => handleVerifyBookingPayment(payment, 'REJECTED')}
                                  >
                                    Reject
                                  </Button>
                                </>
                              ) : (
                                <div className="rounded-2xl bg-cream/70 border border-espresso/[0.04] p-3 text-xs text-espresso/60">
                                  <p className="font-black text-espresso">Verified by</p>
                                  <p>{payment.verified_by_details?.username || 'N/A'}</p>
                                  <p>{payment.verified_at ? new Date(payment.verified_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={CreditCard} title="No payments found" description="Submitted GCash booking payments will appear here for verification." />
                )}
              </Card>
            </div>
          )}

          {/* STAFF ACCOUNTS */}
          {activeTab === 'staff' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in-up" key="staff">
              <div className="lg:col-span-4">
                <Card>
                  <CardHeader title="Add Staff User" />
                  <form onSubmit={handleCreateStaff} className="space-y-4">
                    <Input label="Username" required value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="username" />
                    <Input label="Password" type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="password" />
                    <Input label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="staff@cav.com" />
                    <Select
                      label="Role"
                      value={newRole}
                      onChange={e => setNewRole(e.target.value)}
                      options={[
                        { value: 'STAFF', label: 'Regular Staff' },
                        { value: 'ADMIN', label: 'Super Administrator' },
                        { value: 'CUSTOMER', label: 'Customer Profile' },
                      ]}
                    />
                    <Button type="submit" variant="primary" className="w-full" icon={Plus}>
                      Save User Profile
                    </Button>
                  </form>
                </Card>
              </div>

              <div className="lg:col-span-8">
                <Card>
                  <CardHeader title="Existing Accounts" />
                  {staffList.length > 0 ? (
                    <div className="overflow-x-auto -mx-6">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-espresso/5 text-espresso/50 font-bold uppercase tracking-wider">
                            <th className="p-4 text-left">ID</th>
                            <th className="p-4 text-left">Username</th>
                            <th className="p-4 text-left">Email</th>
                            <th className="p-4 text-left">Role</th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffList.map((st, i) => (
                            <tr key={st.id} className="border-b border-espresso/5 hover:bg-espresso/[0.02] transition-colors animate-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                              <td className="p-4 font-mono text-espresso/50">#{st.id}</td>
                              <td className="p-4 font-semibold text-espresso">{st.username}</td>
                              <td className="p-4 text-espresso/60">{st.email || 'N/A'}</td>
                              <td className="p-4"><StatusBadge status={st.role} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in-up" key="faq">
              <div className="lg:col-span-4">
                <Card>
                  <CardHeader title={editingFaq ? 'Update FAQ Entry' : 'Add FAQ Entry'} />
                  <form onSubmit={handleFAQSubmit} className="space-y-4">
                    <Input label="Question" required value={faqQuestion} onChange={e => setFaqQuestion(e.target.value)} placeholder="e.g. Do you accept credit cards?" />
                    <Textarea label="Answer" required value={faqAnswer} onChange={e => setFaqAnswer(e.target.value)} placeholder="e.g. Yes! We accept Mastercard, Visa, and GCash." rows={4} />
                    <Input label="Tags / Keywords" value={faqTags} onChange={e => setFaqTags(e.target.value)} placeholder="e.g. card, payment, visa" />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" className="flex-1" icon={Check}>
                        Save FAQ
                      </Button>
                      {editingFaq && (
                        <Button variant="outline" onClick={() => { setFaqQuestion(''); setFaqAnswer(''); setFaqTags(''); setEditingFaq(null); }}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                </Card>
              </div>

              <div className="lg:col-span-8">
                <Card>
                  <CardHeader title="Knowledge Base FAQs" subtitle="RAG-powered question bank" />
                  {faqs.length > 0 ? (
                    <div className="space-y-3">
                      {faqs.map((faq, i) => (
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
                              onClick={() => { setEditingFaq(faq); setFaqQuestion(faq.question); setFaqAnswer(faq.answer); setFaqTags(faq.tags || ''); }}
                            />
                            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDeleteFAQ(faq.id)} className="text-red-500 hover:text-red-700" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={MessageSquare} title="No FAQs yet" description="Add your first FAQ entry to power the chatbot." />
                  )}
                </Card>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
