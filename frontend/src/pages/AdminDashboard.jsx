import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client, { DATA_CHANGED_EVENT, getApiErrorMessage, getCached } from '../api/client';
import {
  TrendingUp, BarChart2, Users, MessageSquare, Play, Package,
  AlertTriangle, DollarSign, Check, Plus, Trash2, Edit,
  X, Calendar, CreditCard, ClipboardCheck, ShoppingBag, ArrowUpRight,
  ArrowDownRight, Camera, Printer, Upload, ChevronLeft, ChevronRight,
  Star, Quote, ThumbsUp, ThumbsDown, Minus, ClipboardList, Search
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, BarChart, Bar
} from 'recharts';
import { Button, IconButton } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/Badge';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner, Skeleton, SkeletonChart, SkeletonStatsCard, SkeletonTable, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import PaymentProofPreview from '../components/PaymentProofPreview';
import { MobileHeader } from '../components/ui/MobileHeader';
import { DataTable as DashboardTable, PaginationControls, paginateRows, sortRows } from '../components/ui/DataTable';
import { useStyledConfirm } from '../components/ui/StyledAlert';
import { Avatar } from '../components/ui/Avatar';
import { PasswordStrength } from '../components/ui/PasswordStrength';
import { calculateSalesRowsPerPage } from './salesLogLayout';
import {
  aggregateSalesChartData,
  buildSalesForecastChartData,
  filterSalesChartData,
  getSalesYAxisDomain,
  panSalesChartRange,
  selectSalesForecastRows,
  zoomSalesChartRange,
} from './salesForecastChartData';
import AuditLogsPage from './admin/AuditLogsPage';
import GalleryManager from './admin/GalleryManager';
import IngredientStatusModal from '../components/admin/IngredientStatusModal';
import LiveInventoryPage from './admin/LiveInventoryPage';
import {
  getEmailError,
  getPasswordError,
  getPhoneError,
  getRequiredError,
} from '../utils/validation';
import {
  normalizeDashboardAnalytics,
  normalizePayments,
  normalizeRowsById,
  asArray,
  asRecord,
} from '../utils/uniqueRecords';
import { formatManilaDateTime, MANILA_TIME_ZONE } from '../utils/dateTime';
import { getDashboardRangeDates } from '../utils/dashboardDateRange';
import { hasDashboardOperationalRecords, validateDashboardAnalytics } from '../utils/dashboardAnalytics';
import {
  getLocalPrinters,
  getLocalPrintingSetupMessage,
  isLocalStaffConsole,
  openLocalStaffConsole,
  printLocalEndOfDayReport,
} from '../utils/localPrinting';

const LOCAL_PRINTING_PRINTER_KEY = 'admin:localPrintingPrinter';

const readLocalStorageValue = (key, fallback = '') => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})}`;

const CloseoutMetric = ({ label, value, valueClassName = 'text-espresso' }) => (
  <div className="min-w-0 rounded-xl border border-espresso/[0.07] bg-white p-3">
    <p className="text-[9px] font-black uppercase tracking-wider text-espresso/45">{label}</p>
    <p className={`mt-1 break-words text-sm font-black ${valueClassName}`}>{value}</p>
  </div>
);

const EndOfDayReportDetailsModal = ({ report, onClose, isLoading = false, error = '' }) => {
  if (!report) return null;
  const transactions = Array.isArray(report.transactions) ? report.transactions : [];
  const transactionIds = Array.isArray(report.transaction_ids) && report.transaction_ids.length
    ? report.transaction_ids
    : [report.first_transaction_id, report.last_transaction_id].filter((value, index, values) => value && values.indexOf(value) === index);
  const printHistory = Array.isArray(report.print_history) ? report.print_history : [];
  const hasTransactionSnapshot = transactions.length > 0;

  return (
    <Modal
      open={Boolean(report)}
      onClose={onClose}
      title={`Saved Closeout · ${report.report_date}`}
      size="5xl"
      className="max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden"
      bodyClassName="max-h-[calc(100vh-8rem)] max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto p-4 sm:p-6"
    >
      <section className="rounded-2xl border border-espresso/10 bg-cream/55 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-espresso">Closeout report #{report.id}</p>
            <p className="mt-1 break-words text-xs font-bold text-espresso/60">
              Closed by {report.staff_name || report.closed_by_name || 'Admin'}
              {report.closed_by != null ? ` · Admin ID ${report.closed_by}` : ''}
            </p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-[10px] font-black ${Number(report.cash_difference) === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            Cash difference {formatCurrency(report.cash_difference)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <CloseoutMetric label="Report date" value={report.report_date || 'Not recorded'} />
          <CloseoutMetric label="Opening time" value={formatManilaDateTime(report.opening_time) || 'Not recorded'} />
          <CloseoutMetric label="Closing time" value={formatManilaDateTime(report.closing_time) || 'Not recorded'} />
          <CloseoutMetric label="Saved at" value={formatManilaDateTime(report.created_at) || 'Not recorded'} />
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/35 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Report totals</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <CloseoutMetric label="Transactions" value={report.total_transactions ?? 0} />
          <CloseoutMetric label="Items sold" value={report.total_items_sold ?? 0} />
          <CloseoutMetric label="Gross sales" value={formatCurrency(report.gross_sales)} />
          <CloseoutMetric label="Discounts" value={formatCurrency(report.discounts)} />
          <CloseoutMetric label="Refunds" value={formatCurrency(report.refunds)} />
          <CloseoutMetric label="Cancelled / voided" value={report.cancelled_or_voided_transactions ?? 0} />
          <CloseoutMetric label="Booking income" value={formatCurrency(report.booking_income)} />
          <CloseoutMetric label="Cafe POS income" value={formatCurrency(report.cafe_pos_income)} />
        </div>
        <div className="mt-3 rounded-xl border border-espresso/[0.07] bg-white p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-espresso/45">Transaction IDs</p>
          {transactionIds.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {transactionIds.map((transactionId, index) => (
                <li key={`${transactionId}-${index}`} className="max-w-full break-all rounded-lg bg-gold/10 px-2.5 py-1 text-[10px] font-black text-gold-dark">{transactionId}</li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-espresso/50">No transaction IDs were saved with this report.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/35 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Payment breakdown</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <CloseoutMetric label="Cash" value={formatCurrency(report.cash_sales)} />
          <CloseoutMetric label="GCash" value={formatCurrency(report.gcash_sales)} />
          <CloseoutMetric label="Card" value={formatCurrency(report.card_sales)} />
          <CloseoutMetric label="Other payments" value={formatCurrency(report.other_payment_sales)} />
          <CloseoutMetric label="Booking income" value={formatCurrency(report.booking_income)} />
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/35 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Cash reconciliation</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <CloseoutMetric label="Opening cash" value={formatCurrency(report.opening_cash)} />
          <CloseoutMetric label="Cash sales" value={formatCurrency(report.cash_sales)} />
          <CloseoutMetric label="Cash in / out" value={formatCurrency(report.cash_in_out)} />
          <CloseoutMetric label="Expected cash" value={formatCurrency(report.expected_cash)} />
          <CloseoutMetric label="Actual cash counted" value={formatCurrency(report.actual_cash)} />
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/35 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Itemized transactions</h3>
          <span className="text-[10px] font-bold text-espresso/50">{transactions.length} saved transaction{transactions.length === 1 ? '' : 's'}</span>
        </div>
        {report.transactions_reconstructed && hasTransactionSnapshot && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900">
            This older report predates transaction snapshots. Its item details are loaded from the recorded transactions for the report date; the saved report totals remain unchanged.
          </p>
        )}
        {isLoading ? (
          <p role="status" className="mt-3 rounded-xl border border-espresso/[0.07] bg-white p-4 text-xs font-bold text-espresso/60">Loading transaction details…</p>
        ) : error ? (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-800">{error}</p>
        ) : hasTransactionSnapshot ? (
          <div className="mt-3 space-y-3">
            {transactions.map((transaction, transactionIndex) => (
              <article key={transaction.id || transaction.transaction_id || transactionIndex} className="min-w-0 rounded-xl border border-espresso/[0.08] bg-white p-3 sm:p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all text-xs font-black text-espresso">
                      {transaction.transaction_id || `Transaction ${transaction.id || transactionIndex + 1}`}
                    </p>
                    <p className="mt-1 break-words text-[10px] font-bold text-espresso/55">
                      {String(transaction.type || 'Transaction').replace(/_/g, ' ')}
                      {transaction.booking_id ? ` · Booking #${transaction.booking_id}` : ''}
                      {transaction.booking_customer_name ? ` · ${transaction.booking_customer_name}` : ''}
                      {transaction.staff_name ? ` · ${transaction.staff_name}` : ''}
                    </p>
                    {transaction.created_at && <p className="mt-1 text-[10px] text-espresso/50">{formatManilaDateTime(transaction.created_at)}</p>}
                  </div>
                  <p className="shrink-0 text-sm font-black text-gold-dark">Total {formatCurrency(transaction.total)}</p>
                </div>

                {transaction.items?.length ? (
                  <div className="mt-3 space-y-2 border-t border-espresso/[0.07] pt-3">
                    {transaction.items.map((item, itemIndex) => (
                      <div key={item.id || `${item.name}-${itemIndex}`} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-cream/50 p-2 text-[10px] sm:grid-cols-4">
                        <p className="col-span-2 break-words font-black text-espresso sm:col-span-1">{item.name || 'Item'}</p>
                        <p className="text-espresso/65">Qty {item.quantity ?? 0}{Number(item.returned_quantity) > 0 ? ` · ${item.returned_quantity} returned` : ''}</p>
                        <p className="break-words text-espresso/65">Unit {formatCurrency(item.price)}</p>
                        <p className="break-words font-bold text-espresso/75">Line {formatCurrency(item.net_subtotal ?? item.subtotal)}</p>
                        {Number(item.discount_amount) > 0 && <p className="col-span-2 text-amber-700 sm:col-span-4">Item discount {formatCurrency(item.discount_amount)}</p>}
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-3 border-t border-espresso/[0.07] pt-3 text-[10px] text-espresso/50">No item lines were recorded for this transaction.</p>}

                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-espresso/[0.07] pt-3 sm:grid-cols-4">
                  <CloseoutMetric label="Subtotal" value={formatCurrency(transaction.subtotal)} />
                  <CloseoutMetric label="Discount" value={`${transaction.discount_type ? `${transaction.discount_type} ` : ''}${formatCurrency(transaction.discount_amount)}`} />
                  <CloseoutMetric label="Refunds" value={formatCurrency(transaction.refunds)} />
                  <CloseoutMetric label="Total" value={formatCurrency(transaction.total)} valueClassName="text-gold-dark" />
                </div>
                {transaction.payments?.length > 0 && (
                  <div className="mt-3 border-t border-espresso/[0.07] pt-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-espresso/45">Payments</p>
                    <div className="mt-1 space-y-1">
                      {transaction.payments.map((payment, paymentIndex) => (
                        <p key={payment.id || payment.transaction_id || paymentIndex} className="break-words text-[10px] font-medium text-espresso/65">
                          {payment.method || 'Payment'} · {formatCurrency(payment.amount)}
                          {payment.transaction_id ? ` · ${payment.transaction_id}` : ''}
                          {payment.reference_number ? ` · Ref ${payment.reference_number}` : ''}
                          {payment.paid_at ? ` · ${formatManilaDateTime(payment.paid_at)}` : ''}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            {report.transactions_reconstructed
              ? 'No transaction-level records are available for this older report date. Its saved aggregate item summary is shown below where available.'
              : 'This older saved report does not contain a transaction-level snapshot. Its saved aggregate item summary is shown below where available.'}
            {report.best_selling_items?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.best_selling_items.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}: {item.quantity} units · {formatCurrency(item.total)}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/35 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Print history</h3>
        {printHistory.length ? (
          <ol className="mt-3 space-y-2">
            {printHistory.map((entry, index) => (
              <li key={`${entry.recorded_at || 'print'}-${index}`} className="rounded-xl border border-espresso/[0.07] bg-white p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-black text-espresso">{String(entry.event || 'print').replace(/_/g, ' ')} · {entry.printed ? 'Printed' : 'Not printed'}</p>
                  <p className="text-[10px] text-espresso/55">{formatManilaDateTime(entry.recorded_at) || 'Time not recorded'}</p>
                </div>
                {entry.printer && <p className="mt-1 break-words text-[10px] text-espresso/65">Printer: {entry.printer}</p>}
                {entry.error && <p className="mt-1 break-words text-[10px] text-amber-800">{entry.error}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-espresso/55">No print history was recorded for this report.</p>
        )}
        {report.print_status?.error && !printHistory.some(entry => entry.error === report.print_status.error) && (
          <p className="mt-2 break-words text-xs text-amber-800">Latest print status: {report.print_status.error}</p>
        )}
      </section>
    </Modal>
  );
};

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

const finiteForecastValue = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const sumForecastValues = (rows, key) => {
  if (!rows.length) return null;
  const values = rows.map(row => finiteForecastValue(row?.[key]));
  return values.some(value => value === null) ? null : values.reduce((total, value) => total + value, 0);
};
const formatForecastAmount = value => value === null ? '—' : formatCurrency(value);

const emptyAccountForm = () => ({
  username: '',
  password: '',
  email: '',
  first_name: '',
  last_name: '',
  phone_number: '',
  address: '',
  role: 'STAFF',
});

const getAccountValidationErrors = (form, { passwordRequired = false } = {}) => {
  const isCustomer = form.role === 'CUSTOMER';
  const errors = {
    username: getRequiredError(form.username, 'Username'),
    email: getEmailError(form.email, { required: isCustomer }),
    password: passwordRequired
      ? getPasswordError(form.password)
      : (form.password.trim() ? getPasswordError(form.password, 'New password') : ''),
    first_name: isCustomer ? getRequiredError(form.first_name, 'First name') : '',
    last_name: isCustomer ? getRequiredError(form.last_name, 'Last name') : '',
    phone_number: isCustomer && !form.phone_number.trim()
      ? 'Phone number is required.'
      : getPhoneError(form.phone_number),
    address: isCustomer ? getRequiredError(form.address, 'Address') : '',
  };
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
};

const getAccountErrorMessage = (value) => Array.isArray(value) ? value.join(' ') : value;

const formatForecastDate = value => {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', { timeZone: MANILA_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' });
};

function SalesForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const periodLabel = row.period_start && row.period_end && row.period_start !== row.period_end
    ? `${formatForecastDate(row.period_start)} – ${formatForecastDate(row.period_end)}`
    : formatForecastDate(label || row.date);
  return (
    <div className="rounded-2xl border border-espresso/[0.08] bg-white/95 p-3 text-xs shadow-[0_18px_45px_rgba(46,26,17,0.12)]">
      <p className="mb-2 font-black text-espresso">{periodLabel}</p>
      {row.actual_sales != null && (
        <p className="font-bold text-espresso/75">Actual: {formatCurrency(row.actual_sales)}</p>
      )}
      {row.is_imputed && (
        <p className="font-semibold text-amber-700">No recorded sale (gap filled for the model)</p>
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
// Charts measure their container and can occasionally fail in restricted or
// mid-layout browser states. Keep the rest of the management console usable
// when a third-party chart cannot initialise.
class DashboardChartBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previousProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex h-full min-h-24 items-center justify-center rounded-xl bg-cream/70 px-4 text-center text-xs font-semibold text-espresso/55">
        This chart could not be displayed. The dashboard data is still available below.
      </div>
    );
  }
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
export function AdminSkeleton({ pageTitle }) {
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
        <div className="mb-6 flex items-center gap-3 text-xs font-bold text-espresso/60" role="status">
          <LoadingSpinner className="text-gold-dark" label={`Loading ${pageTitle}`} />
          Loading {pageTitle}...
        </div>
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
  const [forecastLoading, setForecastLoading] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [inventoryIngredients, setInventoryIngredients] = useState([]);
  const [productSalesInventory, setProductSalesInventory] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [bookingPayments, setBookingPayments] = useState([]);
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [studioUnavailableDates, setStudioUnavailableDates] = useState([]);
  const [endOfDayReports, setEndOfDayReports] = useState([]);
  const [ingredientStatusOpen, setIngredientStatusOpen] = useState(false);
  const [selectedInventoryStatus, setSelectedInventoryStatus] = useState({ key: 'EXPIRED', label: 'Expired' });
  const [loading, setLoading] = useState(true);
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [dataError, setDataError] = useState('');
  const [analyticsError, setAnalyticsError] = useState('');
  const [forecastError, setForecastError] = useState('');

  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [faqTags, setFaqTags] = useState('');
  const [editingFaq, setEditingFaq] = useState(null);
  const [faqSaving, setFaqSaving] = useState(false);
  const [deletingFaqId, setDeletingFaqId] = useState(null);

  const [newAccountForm, setNewAccountForm] = useState(emptyAccountForm);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [editStaffForm, setEditStaffForm] = useState(emptyAccountForm);
  const [staffSaving, setStaffSaving] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [deletingStaffId, setDeletingStaffId] = useState(null);
  const [newStaffErrors, setNewStaffErrors] = useState({});
  const [editStaffErrors, setEditStaffErrors] = useState({});
  const [faqErrors, setFaqErrors] = useState({});

  const [retrainLoading, setRetrainLoading] = useState(false);
  const [salesHistoryFile, setSalesHistoryFile] = useState(null);
  const [salesHistoryUploadLoading, setSalesHistoryUploadLoading] = useState(false);
  const [datePreset, setDatePreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [forecastView, setForecastView] = useState('next_7_days');
  const [salesChartGranularity, setSalesChartGranularity] = useState('daily');
  const [salesChartStartDate, setSalesChartStartDate] = useState('');
  const [salesChartEndDate, setSalesChartEndDate] = useState('');
  const [salesChartRange, setSalesChartRange] = useState(null);
  const [salesChartDragging, setSalesChartDragging] = useState(false);
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
  const paymentListRef = useRef(null);
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(10);
  const staffTableAreaRef = useRef(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState('ALL');
  const [faqPage, setFaqPage] = useState(1);
  const [faqPageSize, setFaqPageSize] = useState(10);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPageSize, setReviewPageSize] = useState(10);
  const [bookingSort, setBookingSort] = useState({ key: 'created_at', dir: 'desc' });
  const [posSort, setPosSort] = useState({ key: 'date', dir: 'desc' });
  const [reorderSort, setReorderSort] = useState({ key: 'projected_stock', dir: 'asc' });
  const [staffSort, setStaffSort] = useState({ key: 'username', dir: 'asc' });
  const [deletingBookingId, setDeletingBookingId] = useState(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('PENDING_VERIFICATION');
  const [verifyingPaymentId, setVerifyingPaymentId] = useState(null);
  const [receiptPrintError, setReceiptPrintError] = useState('');
  const [endOfDayModalOpen, setEndOfDayModalOpen] = useState(false);
  const [selectedEndOfDayReport, setSelectedEndOfDayReport] = useState(null);
  const [endOfDayDetailLoading, setEndOfDayDetailLoading] = useState(false);
  const [endOfDayDetailError, setEndOfDayDetailError] = useState('');
  const [endOfDayDate, setEndOfDayDate] = useState(todayValue());
  const [endOfDayOpeningCash, setEndOfDayOpeningCash] = useState('0.00');
  const [endOfDayCashInOut, setEndOfDayCashInOut] = useState('0.00');
  const [endOfDayCashSales, setEndOfDayCashSales] = useState('');
  const [endOfDayBookingIncome, setEndOfDayBookingIncome] = useState('');
  const [endOfDayGcashSales, setEndOfDayGcashSales] = useState('');
  const [endOfDayGrossSales, setEndOfDayGrossSales] = useState('');
  const [endOfDayActualCash, setEndOfDayActualCash] = useState('');
  const [endOfDayExpectedCash, setEndOfDayExpectedCash] = useState('');
  const [endOfDayCashLoading, setEndOfDayCashLoading] = useState(false);
  const [endOfDayPrinting, setEndOfDayPrinting] = useState(false);
  const [endOfDayReprintingId, setEndOfDayReprintingId] = useState(null);
  const [localPrinters, setLocalPrinters] = useState([]);
  const [selectedLocalPrinter, setSelectedLocalPrinter] = useState(() => readLocalStorageValue(LOCAL_PRINTING_PRINTER_KEY));
  const [localPrinterLoading, setLocalPrinterLoading] = useState(false);
  const [localPrintStatus, setLocalPrintStatus] = useState('Detect the cashier printer before printing a closeout.');
  const [tabLoading, setTabLoading] = useState({});
  const dashboardFetchSeqRef = useRef(0);
  const forecastFetchSeqRef = useRef(0);
  const endOfDayDetailsRequestRef = useRef(0);
  const salesChartInteractionElementRef = useRef(null);
  const salesChartInteractionRef = useRef(null);

  const loadAdminTabData = useCallback(async (tab, { force = false } = {}) => {
    if (tab === 'analytics') return;
    setTabLoading(current => ({ ...current, [tab]: true }));
    try {
      if (tab === 'calendar') {
        const [bookingsRes, unavailableRes] = await Promise.all([
          getCached('/api/bookings/', { params: { month: bookingCalendarMonth, limit: 500 } }, { force }),
          getCached('/api/bookings/studio-unavailable-dates/', { params: { month: bookingCalendarMonth } }, { force }),
        ]);
        setCalendarBookings(normalizeRowsById(bookingsRes.data, row => row?.id));
        setStudioUnavailableDates(normalizeRowsById(unavailableRes.data, row => row?.date));
      } else if (tab === 'reports') {
        const response = await getCached('/api/pos/end-of-day-reports/', {}, { force });
        setEndOfDayReports(normalizeRowsById(response.data, row => row?.report_number || row?.created_at));
      } else if (tab === 'payments') {
        const response = await getCached('/api/bookings/payments/', {}, { force });
        setBookingPayments(normalizePayments(response.data));
      } else if (tab === 'staff') {
        const response = await getCached('/api/auth/users/', {}, { force });
        setStaffList(normalizeRowsById(response.data, row => row?.username || row?.email));
      } else if (tab === 'faq') {
        const response = await getCached('/api/chatbot/faqs/', {}, { force });
        setFaqs(normalizeRowsById(response.data, row => row?.question));
      } else if (tab === 'reviews') {
        const response = await getCached('/api/bookings/reviews/all/', {}, { force });
        setReviews(normalizeRowsById(response.data, row => row?.id));
      } else if (tab === 'inventory') {
        const [ingredientsRes, productSalesRes] = await Promise.all([
          getCached('/api/inventory/ingredients/', { params: { limit: 300 } }, { force }),
          getCached('/api/inventory/product-sales/', {}, { force }),
        ]);
        setInventoryIngredients(normalizeRowsById(ingredientsRes.data, row => row?.id || row?.name));
        setProductSalesInventory(normalizeRowsById(productSalesRes.data, row => row?.product_id || row?.product_name));
      }
    } catch (error) {
      setDataError(getApiErrorMessage(error, `Could not load ${tab} data.`));
    } finally {
      setTabLoading(current => ({ ...current, [tab]: false }));
    }
  }, [bookingCalendarMonth]);

  const loadForecast = useCallback(async ({ force = false } = {}) => {
    const requestSeq = forecastFetchSeqRef.current + 1;
    forecastFetchSeqRef.current = requestSeq;
    setForecastLoading(true);
    setForecastError('');
    try {
      const response = await getCached('/api/forecasting/predictions/', {}, { force });
      if (requestSeq !== forecastFetchSeqRef.current) return;
      const data = response?.data || null;
      const hasForecastRows = Array.isArray(data?.sales_forecast) && data.sales_forecast.some(row => finiteForecastValue(row?.predicted_sales) !== null);
      if (data?.status === 'ok' && hasForecastRows) {
        setForecast(data);
      } else {
        setForecast(null);
        setForecastError(data?.detail || 'The forecasting service did not return valid daily predictions.');
      }
    } catch (error) {
      if (requestSeq === forecastFetchSeqRef.current) {
        setForecast(null);
        setForecastError(getApiErrorMessage(error, 'Forecast data could not be loaded.'));
      }
    } finally {
      if (requestSeq === forecastFetchSeqRef.current) setForecastLoading(false);
    }
  }, []);

  const fetchData = useCallback(async ({ background = false } = {}) => {
    const requestSeq = dashboardFetchSeqRef.current + 1;
    dashboardFetchSeqRef.current = requestSeq;
    try {
      const range = getDashboardRangeDates(datePreset, customStart, customEnd);
      if (!background) setLoading(true);
      setAnalyticsError('');
      const response = await getCached('/api/dashboard/analytics/', { params: { ...range, grain: 'daily' } }, { force: true });
      if (requestSeq !== dashboardFetchSeqRef.current) return;
      const validationError = validateDashboardAnalytics(response?.data, range);
      if (validationError) {
        setAnalyticsError(validationError);
      } else {
        setAnalytics(normalizeDashboardAnalytics(response.data));
        setAnalyticsError('');
        setDataError('');
      }
    } catch (err) {
      console.error(err);
      if (requestSeq === dashboardFetchSeqRef.current) {
        setAnalyticsError(getApiErrorMessage(err, 'Failed to load Business Overview metrics.'));
      }
    } finally {
      if (!background && requestSeq === dashboardFetchSeqRef.current) {
        setLoading(false);
        setInitialDataReady(true);
      }
    }
  }, [datePreset, customStart, customEnd]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, fetchData]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN' || !initialDataReady) return undefined;
    let cancelled = false;
    let idleId;
    const timerId = window.setTimeout(() => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(() => { if (!cancelled) void loadForecast(); }, { timeout: 2500 });
      } else {
        void loadForecast();
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
    };
  }, [user, initialDataReady, loadForecast]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;
    void loadAdminTabData(activeTab);
  }, [activeTab, bookingCalendarMonth, loadAdminTabData, user]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return undefined;

    const refresh = () => {
      fetchData({ background: true });
      loadAdminTabData(activeTab, { force: true });
    };
    const refreshInterval = activeTab === 'calendar' || activeTab === 'payments' ? 5000 : 30000;
    const intervalId = window.setInterval(refresh, refreshInterval);
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
  }, [user, activeTab, fetchData, loadAdminTabData]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return undefined;
    const refreshChangedData = () => {
      fetchData({ background: true });
      loadAdminTabData(activeTab, { force: true });
    };
    window.addEventListener(DATA_CHANGED_EVENT, refreshChangedData);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refreshChangedData);
  }, [user, activeTab, fetchData, loadAdminTabData]);

  const validateNewStaffForm = () => {
    return getAccountValidationErrors(newAccountForm, { passwordRequired: true });
  };

  const validateEditStaffForm = () => {
    return getAccountValidationErrors(editStaffForm);
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
      title: 'Create Account',
      message: `Create an account for ${newAccountForm.username || 'this user'}?`,
      confirmLabel: 'Create Account',
      type: 'success',
    });
    if (!confirmed) return;
    try {
      setCreatingStaff(true);
      const res = await client.post('/api/auth/users/', newAccountForm);
      setStaffList(current => normalizeRowsById([res.data, ...current], row => row?.username || row?.email));
      setNewAccountForm(emptyAccountForm());
      setNewStaffErrors({});
      setCreateAccountOpen(false);
      fetchData({ background: true });
      loadAdminTabData('staff', { force: true });
      alert('Account created successfully.');
    } catch (err) {
      const payload = err.response?.data || {};
      setNewStaffErrors(current => ({
        ...current,
        username: getAccountErrorMessage(payload.username || payload.detail) || current.username,
        email: getAccountErrorMessage(payload.email) || current.email,
        password: getAccountErrorMessage(payload.password) || current.password,
        first_name: getAccountErrorMessage(payload.first_name) || current.first_name,
        last_name: getAccountErrorMessage(payload.last_name) || current.last_name,
        phone_number: getAccountErrorMessage(payload.phone_number) || current.phone_number,
        address: getAccountErrorMessage(payload.address) || current.address,
      }));
      alert(payload.detail || 'Failed to create account.');
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
      first_name: staff.first_name || '',
      last_name: staff.last_name || '',
      phone_number: staff.phone_number || '',
      address: staff.address || '',
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
      title: 'Update Account',
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
        first_name: editStaffForm.first_name,
        last_name: editStaffForm.last_name,
        phone_number: editStaffForm.phone_number,
        address: editStaffForm.address,
        role: editStaffForm.role,
      };
      if (editStaffForm.password.trim()) {
        payload.password = editStaffForm.password;
      }
      const res = await client.patch(`/api/auth/users/${editingStaff.id}/`, payload);
      setStaffList(current => normalizeRowsById(current.map(staff => staff.id === editingStaff.id ? res.data : staff), row => row?.username || row?.email));
      setEditingStaff(null);
      setEditStaffForm(emptyAccountForm());
      setEditStaffErrors({});
      fetchData({ background: true });
      loadAdminTabData('staff', { force: true });
      alert('Record updated successfully.');
    } catch (err) {
      const payload = err.response?.data || {};
      setEditStaffErrors(current => ({
        ...current,
        username: getAccountErrorMessage(payload.username || payload.detail) || current.username,
        email: getAccountErrorMessage(payload.email) || current.email,
        password: getAccountErrorMessage(payload.password) || current.password,
        first_name: getAccountErrorMessage(payload.first_name) || current.first_name,
        last_name: getAccountErrorMessage(payload.last_name) || current.last_name,
        phone_number: getAccountErrorMessage(payload.phone_number) || current.phone_number,
        address: getAccountErrorMessage(payload.address) || current.address,
      }));
      alert(payload.detail || 'Failed to update account.');
    } finally {
      setStaffSaving(false);
    }
  };

  const handleDeleteStaff = async (staff) => {
    if (deletingStaffId === staff.id) return;
    const confirmed = await confirm({
      title: 'Delete Account',
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
      fetchData({ background: true });
      loadAdminTabData('staff', { force: true });
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
      let savedFaq;
      if (editingFaq) {
        const res = await client.put(`/api/chatbot/faqs/${editingFaq.id}/`, {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
        savedFaq = res.data;
        setFaqs(current => normalizeRowsById(current.map(faq => faq.id === savedFaq.id ? savedFaq : faq), row => row?.question));
      } else {
        const res = await client.post('/api/chatbot/faqs/', {
          question: faqQuestion, answer: faqAnswer, tags: faqTags
        });
        savedFaq = res.data;
        setFaqs(current => normalizeRowsById([savedFaq, ...current], row => row?.question));
      }
      setFaqQuestion(''); setFaqAnswer(''); setFaqTags(''); setEditingFaq(null); setFaqErrors({});
      fetchData({ background: true });
      alert(editingFaq ? 'Record updated successfully.' : 'Record added successfully.');
    } catch {
      alert('Failed to save FAQ.');
    } finally {
      setFaqSaving(false);
    }
  };

  const handleRetrain = async () => {
    setRetrainLoading(true);
    try {
      await loadForecast({ force: true });
    } finally {
      setRetrainLoading(false);
    }
  };

  const handleSalesHistoryUpload = async () => {
    if (!salesHistoryFile) {
      setForecastError('Choose a CSV file before importing sales history.');
      return;
    }
    setSalesHistoryUploadLoading(true);
    setForecastError('');
    try {
      const formData = new FormData();
      formData.append('file', salesHistoryFile);
      await client.post('/api/forecasting/history/import/', formData);
      setSalesHistoryFile(null);
      await loadForecast({ force: true });
    } catch (error) {
      setForecastError(getApiErrorMessage(error, 'Sales history could not be imported.'));
    } finally {
      setSalesHistoryUploadLoading(false);
    }
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
      setFaqs(current => current.filter(faq => faq.id !== id));
      setFaqPage(page => Math.max(1, Math.min(page, Math.ceil((faqs.length - 1) / faqPageSize) || 1)));
      fetchData({ background: true });
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
      setCalendarBookings(current => current.filter(row => row.id !== booking.id));
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
      const res = await client.post('/api/bookings/studio-unavailable-dates/', {
        date: studioUnavailableDate,
        reason: cleanReason,
      });
      setStudioUnavailableDates(current => normalizeRowsById([res.data, ...current], row => row?.date));
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
      setStudioUnavailableDates(current => current.filter(item => item.id !== row.id));
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
      const res = await client.patch(`/api/bookings/${booking.id}/`, { status: newStatus });
      setCalendarBookings(current => normalizeRowsById(current.map(item => item.id === booking.id ? res.data : item), row => row?.id));
      setAnalytics(current => current ? normalizeDashboardAnalytics({
        ...current,
        recent_bookings: (current.recent_bookings || []).map(item => item.id === booking.id ? { ...item, ...res.data } : item),
      }) : current);
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
      const res = await client.get('/api/pos/end-of-day-summary/', {
        params: {
          report_date: dateValue,
          opening_cash: endOfDayOpeningCash || 0,
          cash_in_out: endOfDayCashInOut || 0,
        },
      });
      const cashSales = Number(res.data.cash_sales || 0).toFixed(2);
      const expectedCash = Number(res.data.expected_cash || 0).toFixed(2);
      setEndOfDayCashSales(cashSales);
      setEndOfDayBookingIncome(Number(res.data.booking_income || 0).toFixed(2));
      setEndOfDayGcashSales(Number(res.data.gcash_sales || 0).toFixed(2));
      setEndOfDayGrossSales(Number(res.data.gross_sales || 0).toFixed(2));
      setEndOfDayExpectedCash(expectedCash);
      setEndOfDayActualCash(expectedCash);
    } catch {
      setEndOfDayCashSales('');
      setEndOfDayBookingIncome('');
      setEndOfDayGcashSales('');
      setEndOfDayGrossSales('');
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

  useEffect(() => {
    if (selectedLocalPrinter) localStorage.setItem(LOCAL_PRINTING_PRINTER_KEY, selectedLocalPrinter);
    else localStorage.removeItem(LOCAL_PRINTING_PRINTER_KEY);
  }, [selectedLocalPrinter]);

  const refreshLocalPrinters = useCallback(async ({ openConsoleOnFailure = false } = {}) => {
    try {
      setLocalPrinterLoading(true);
      const printers = await getLocalPrinters();
      setLocalPrinters(printers);
      const defaultPrinter = printers.find(printer => printer.default) || printers[0];
      if (defaultPrinter && (!selectedLocalPrinter || !printers.some(printer => printer.name === selectedLocalPrinter))) {
        setSelectedLocalPrinter(defaultPrinter.name);
      }
      setLocalPrintStatus(printers.length
        ? `${printers.length} local printer${printers.length === 1 ? '' : 's'} detected. ${defaultPrinter?.name ? `Using ${defaultPrinter.name}.` : ''}`
        : 'The local print bridge is running, but no printers were found.');
      return printers;
    } catch {
      setLocalPrinters([]);
      setLocalPrintStatus(getLocalPrintingSetupMessage());
      if (openConsoleOnFailure && !isLocalStaffConsole()) openLocalStaffConsole();
      return [];
    } finally {
      setLocalPrinterLoading(false);
    }
  }, [selectedLocalPrinter]);

  const handleDetectLocalPrinters = useCallback(async () => {
    const printers = await refreshLocalPrinters({ openConsoleOnFailure: true });
    if (!printers.length && !isLocalStaffConsole()) {
      setLocalPrintStatus('Opening the local staff console. Sign in there, keep it open, then select Detect Printers again.');
    }
  }, [refreshLocalPrinters]);

  const handleLocalEndOfDayPrint = async (report) => {
    const printers = localPrinters.length ? localPrinters : await refreshLocalPrinters();
    if (!printers.length) {
      setReceiptPrintError('Report saved, but no local receipt printer was detected. Start the Local Staff Console on the cashier PC, then use Reprint Closeout.');
      return false;
    }

    const printer = printers.find(item => item.name === selectedLocalPrinter) || printers.find(item => item.default) || printers[0];
    try {
      const result = await printLocalEndOfDayReport({ report, printerName: printer?.name || '' });
      const markedReport = await client.post(`/api/pos/end-of-day-reports/${report.id}/mark-printed/`, {
        printer: result.printer || printer?.name || 'local cashier printer',
      });
      setEndOfDayReports(current => normalizeRowsById(current.map(item => item.id === report.id ? markedReport.data : item), row => row?.report_number || row?.created_at));
      setLocalPrintStatus(`Closeout printed locally${result.printer ? ` on ${result.printer}` : ''}.`);
      return true;
    } catch (err) {
      const message = err?.message || getApiErrorMessage(err, 'The local printer could not print the closeout.');
      setLocalPrintStatus(`Local print failed: ${message}`);
      setReceiptPrintError(`Report saved, but local printing failed: ${message}`);
      try {
        const failedReport = await client.post(`/api/pos/end-of-day-reports/${report.id}/mark-printed/`, {
          printer: printer?.name || selectedLocalPrinter || 'local cashier printer',
          printed: false,
          error: message,
        });
        setEndOfDayReports(current => normalizeRowsById(
          current.map(item => item.id === report.id ? failedReport.data : item),
          row => row?.report_number || row?.created_at
        ));
      } catch {
        // The saved report remains available even if the local print failure cannot be synced.
      }
      return false;
    }
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
        print_report: false,
      });
      setEndOfDayReports(current => normalizeRowsById([res.data, ...current.filter(report => report.id !== res.data.id)], row => row?.report_number || row?.created_at));
      setEndOfDayModalOpen(false);
      setEndOfDayActualCash('');
      setEndOfDayOpeningCash('0.00');
      setEndOfDayCashInOut('0.00');
      setEndOfDayCashSales('');
      setEndOfDayBookingIncome('');
      setEndOfDayGcashSales('');
      setEndOfDayGrossSales('');
      setEndOfDayExpectedCash('');
      const printed = await handleLocalEndOfDayPrint(res.data);
      alert(printed ? 'End-of-day report saved and printed successfully.' : 'End-of-day report saved. Use Reprint Closeout after the cashier printer is ready.');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Could not save the end-of-day report. Please try again.'));
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
    setEndOfDayReprintingId(report.id);
    setReceiptPrintError('');
    const printed = await handleLocalEndOfDayPrint(report);
    setEndOfDayReprintingId(null);
    if (printed) alert('Report reprinted successfully.');
  };

  const handleOpenSavedEndOfDayReport = async (report) => {
    const requestId = endOfDayDetailsRequestRef.current + 1;
    endOfDayDetailsRequestRef.current = requestId;
    setSelectedEndOfDayReport(report);
    setEndOfDayDetailError('');
    if (report.transaction_snapshot_version) {
      setEndOfDayDetailLoading(false);
      return;
    }

    setEndOfDayDetailLoading(true);
    try {
      const response = await client.get(`/api/pos/end-of-day-reports/${report.id}/`);
      if (endOfDayDetailsRequestRef.current === requestId) setSelectedEndOfDayReport(response.data);
    } catch (error) {
      if (endOfDayDetailsRequestRef.current === requestId) {
        setEndOfDayDetailError(getApiErrorMessage(error, 'Could not load transaction details for this saved report.'));
      }
    } finally {
      if (endOfDayDetailsRequestRef.current === requestId) setEndOfDayDetailLoading(false);
    }
  };

  const closeSavedEndOfDayReport = () => {
    endOfDayDetailsRequestRef.current += 1;
    setSelectedEndOfDayReport(null);
    setEndOfDayDetailLoading(false);
    setEndOfDayDetailError('');
  };

  const handleLogout = useCallback(() => {
    alert('Signed out successfully.');
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);
  const navItems = [
    { key: 'analytics', label: 'InsightHub Dashboard', icon: BarChart2, active: activeTab === 'analytics', onClick: () => setActiveTab('analytics') },
    { key: 'calendar', label: 'Booking Calendar', icon: Calendar, active: activeTab === 'calendar', onClick: () => setActiveTab('calendar') },
    { key: 'reports', label: 'End-of-Day Reports', icon: Printer, active: activeTab === 'reports', onClick: () => setActiveTab('reports') },
    { key: 'payments', label: 'Payment Booking Verification', icon: CreditCard, active: activeTab === 'payments', onClick: () => setActiveTab('payments') },
    { key: 'inventory', label: 'Live Inventory', icon: Package, active: activeTab === 'inventory', onClick: () => setActiveTab('inventory') },
    { key: 'staff', label: 'Accounts', icon: Users, active: activeTab === 'staff', onClick: () => setActiveTab('staff') },
    { key: 'faq', label: 'Chatbot Manager', icon: MessageSquare, active: activeTab === 'faq', onClick: () => setActiveTab('faq') },
    { key: 'reviews', label: 'Reviews & Feedback', icon: Star, active: activeTab === 'reviews', onClick: () => setActiveTab('reviews') },
    { key: 'gallery', label: 'Photo Gallery', icon: Camera, active: activeTab === 'gallery', onClick: () => setActiveTab('gallery') },
    { key: 'audit', label: 'Audit Logs', icon: ClipboardList, active: activeTab === 'audit', onClick: () => setActiveTab('audit') },
  ];

  const pageTitles = { analytics: 'InsightHub Dashboard', calendar: 'Booking Calendar', reports: 'End-of-Day Reports', payments: 'Payment Booking Verification', inventory: 'Live Inventory', staff: 'Accounts', faq: 'Chatbot Manager', reviews: 'Reviews & Feedback', gallery: 'Photo Gallery', audit: 'Audit Logs' };
  const isActiveTabLoading = activeTab === 'analytics' ? loading : Boolean(tabLoading[activeTab]);
  const expectedAnalyticsRange = getDashboardRangeDates(datePreset, customStart, customEnd);
  const analyticsRangeMatches = analytics?.range?.start === expectedAnalyticsRange.start
    && analytics?.range?.end === expectedAnalyticsRange.end;
  const analyticsDataAvailable = Boolean(analytics && analyticsRangeMatches && !analyticsError);
  const metrics = analyticsDataAvailable ? asRecord(analytics.metrics) : {};
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
  const allForecastRows = asArray(forecast?.sales_forecast);
  const salesForecastRows = selectSalesForecastRows(allForecastRows, forecastView);
  const csvHistoryRows = asArray(forecast?.actual_history);
  const dashboardHistoryRows = asArray(analytics?.sales_history_chart);
  const salesHistoryRows = csvHistoryRows.length ? csvHistoryRows : dashboardHistoryRows;
  const unfilteredSalesChartData = buildSalesForecastChartData(salesHistoryRows, salesForecastRows);
  const salesChartDataInDateRange = filterSalesChartData(unfilteredSalesChartData, salesChartStartDate, salesChartEndDate);
  const forecastChartData = aggregateSalesChartData(salesChartDataInDateRange, salesChartGranularity);
  const salesChartLastIndex = Math.max(forecastChartData.length - 1, 0);
  const salesChartStartIndex = salesChartRange
    ? Math.max(0, Math.min(salesChartLastIndex, salesChartRange.start))
    : 0;
  const salesChartEndIndex = salesChartRange
    ? Math.max(salesChartStartIndex, Math.min(salesChartLastIndex, salesChartRange.end))
    : salesChartLastIndex;
  const visibleSalesChartData = forecastChartData.slice(salesChartStartIndex, salesChartEndIndex + 1);
  const salesYAxisDomain = getSalesYAxisDomain(visibleSalesChartData, visibleSeries);
  const salesChartDateLimits = {
    min: unfilteredSalesChartData[0]?.date || '',
    max: unfilteredSalesChartData[unfilteredSalesChartData.length - 1]?.date || '',
  };
  const resetSalesChartView = () => {
    setSalesChartStartDate('');
    setSalesChartEndDate('');
    setSalesChartGranularity('daily');
    setSalesChartRange(null);
    setForecastView('next_7_days');
    setVisibleSeries({ actual: true, forecast: true, combined: true });
  };
  const handleSalesChartDateChange = (setter, value) => {
    setter(value);
    setSalesChartRange(null);
  };
  const setSalesChartWindow = useCallback(range => {
    setSalesChartRange(range.start === 0 && range.end === salesChartLastIndex ? null : range);
  }, [salesChartLastIndex]);
  const getSalesChartPointerRatio = useCallback((clientX, chartElement) => {
    const rect = chartElement?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return 0.5;
    const plotStart = rect.left + 107;
    const plotEnd = rect.right - 20;
    if (plotEnd <= plotStart) return 0.5;
    return Math.max(0, Math.min(1, (clientX - plotStart) / (plotEnd - plotStart)));
  }, []);
  const handleSalesChartWheel = useCallback(event => {
    if (forecastChartData.length < 2) return;
    event.preventDefault();
    const cursorRatio = getSalesChartPointerRatio(event.clientX, event.currentTarget);
    const range = zoomSalesChartRange({
      start: salesChartStartIndex,
      end: salesChartEndIndex,
      total: forecastChartData.length,
      factor: Math.exp(Math.max(-0.3, Math.min(0.3, event.deltaY * 0.002))),
      anchorRatio: cursorRatio,
    });
    setSalesChartWindow(range);
  }, [forecastChartData.length, salesChartStartIndex, salesChartEndIndex, getSalesChartPointerRatio, setSalesChartWindow]);
  const handleSalesChartMouseDown = useCallback(event => {
    if (event.button !== 0 || forecastChartData.length < 2) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    salesChartInteractionRef.current = {
      startX: event.clientX,
      startIndex: salesChartStartIndex,
      endIndex: salesChartEndIndex,
      plotWidth: Math.max(rect.width - 127, 1),
    };
    setSalesChartDragging(true);
  }, [forecastChartData.length, salesChartStartIndex, salesChartEndIndex]);
  const handleSalesChartMouseMove = useCallback(event => {
    const drag = salesChartInteractionRef.current;
    if (!drag) return;
    const windowSize = drag.endIndex - drag.startIndex + 1;
    const dateShift = -((event.clientX - drag.startX) / drag.plotWidth) * windowSize;
    setSalesChartWindow(panSalesChartRange({
      start: drag.startIndex,
      end: drag.endIndex,
      total: forecastChartData.length,
      delta: dateShift,
    }));
  }, [forecastChartData.length, setSalesChartWindow]);
  const handleSalesChartMouseEnd = useCallback(() => {
    if (!salesChartInteractionRef.current) return;
    salesChartInteractionRef.current = null;
    setSalesChartDragging(false);
  }, []);
  useEffect(() => {
    if (!salesChartDragging) return undefined;
    const onMove = event => handleSalesChartMouseMove(event);
    const onUp = () => handleSalesChartMouseEnd();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [salesChartDragging, handleSalesChartMouseMove, handleSalesChartMouseEnd]);
  useEffect(() => {
    const element = salesChartInteractionElementRef.current;
    if (!element) return undefined;
    const onWheel = event => handleSalesChartWheel(event);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [handleSalesChartWheel]);
  const next7Summary = asRecord(forecast?.forecast_ranges?.next_7_days);
  const nextWeekSummary = asRecord(forecast?.forecast_ranges?.next_week);
  const next7Forecast = finiteForecastValue(next7Summary.total_predicted_sales) ?? sumForecastValues(allForecastRows.slice(0, 7), 'predicted_sales');
  const nextWeekForecast = finiteForecastValue(nextWeekSummary.total_predicted_sales) ?? sumForecastValues(allForecastRows.slice(7, 14), 'predicted_sales');
  const forecastMetrics = asRecord(forecast?.metrics);
  const forecastAccuracy = forecastMetrics.accuracy_available && finiteForecastValue(forecastMetrics.wape) !== null
    ? Math.round(Math.max(0, Math.min(100, (1 - Math.min(Number(forecastMetrics.wape), 1)) * 100)))
    : null;
  const backtestAvailable = forecastAccuracy !== null && forecastMetrics.holdout_days > 0;
  const salesModel = asRecord(forecast?.model);
  const trainingComputation = asRecord(salesModel.training_computation);
  const finalComputation = asRecord(salesModel.final_model_computation);
  const productForecastSummary = asArray(forecast?.product_forecast_summary);
  const forecastQualityMessage = forecast?.data_sufficiency?.message || 'No model evaluation is available.';
  const topProducts = asArray(analytics?.top_selling_products);
  const topPackages = asArray(analytics?.top_booked_packages);
  const topProductRows = paginateRows(topProducts, topProductsPage, topProductsPageSize);
  const topPackageRows = paginateRows(topPackages, topPackagesPage, topPackagesPageSize);
  const reorderRows = asArray(forecast?.reorder_recommendations);
  const sortedReorderRows = sortRows(reorderRows, reorderSort);
  const reorderPageRows = paginateRows(sortedReorderRows, reorderPage, reorderPageSize);
  const inventoryCounts = asRecord(analytics?.inventory_status_counts);
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
  const staffRoleFilterOptions = [
    { value: 'ALL', label: 'All' },
    { value: 'ADMIN', label: 'Admin' },
    { value: 'STAFF', label: 'Staff' },
    { value: 'CUSTOMER', label: 'Customers' },
  ];
  const staffRoleCounts = staffList.reduce((counts, account) => {
    const role = String(account.role || '').toUpperCase();
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const normalizedStaffSearch = staffSearch.trim().toLowerCase();
  const filteredStaffList = staffList.filter(account => {
    const matchesRole = staffRoleFilter === 'ALL' || String(account.role || '').toUpperCase() === staffRoleFilter;
    const searchableText = [
      account.username,
      account.first_name,
      account.last_name,
      account.email,
      account.phone_number,
      account.address,
    ].filter(Boolean).join(' ').toLowerCase();
    return matchesRole && (!normalizedStaffSearch || searchableText.includes(normalizedStaffSearch));
  });
  const sortedStaffList = sortRows(filteredStaffList, staffSort);
  const staffPageRows = paginateRows(sortedStaffList, staffPage, staffPageSize);
  useLayoutEffect(() => {
    if (activeTab !== 'staff') return undefined;
    const tableArea = staffTableAreaRef.current;
    if (!tableArea || !tableArea.clientHeight) return undefined;

    const measureRows = () => {
      const availableHeight = tableArea.clientHeight;
      if (!availableHeight) return;
      const table = tableArea.querySelector('table');
      const headerHeight = table?.querySelector('thead')?.getBoundingClientRect().height || 0;
      const rowHeights = Array.from(table?.querySelectorAll('tbody tr') || [])
        .map(row => row.getBoundingClientRect().height);
      const nextPageSize = calculateSalesRowsPerPage({
        availableHeight,
        headerHeight,
        rowHeights,
        defaultRowHeight: 54,
      });
      setStaffPageSize(current => (current === nextPageSize ? current : nextPageSize));
      setStaffPage(current => Math.min(Math.max(current, 1), Math.max(1, Math.ceil(filteredStaffList.length / nextPageSize))));
    };

    measureRows();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureRows) : null;
    observer?.observe(tableArea);
    window.addEventListener('resize', measureRows);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureRows);
    };
  }, [activeTab, staffPage, staffPageSize, staffSort, staffList, staffSearch, staffRoleFilter, filteredStaffList.length]);
  const faqPageRows = paginateRows(faqs, faqPage, faqPageSize);
  const reviewPageRows = paginateRows(reviews, reviewPage, reviewPageSize);
  const reviewCounts = reviews.reduce((acc, review) => {
    acc[review.sentiment] = (acc[review.sentiment] || 0) + 1;
    return acc;
  }, {});
  const keyComments = [...reviews]
    .filter(review => review.feedback || review.suggestions)
    .sort((a, b) => (Math.abs(Number(b.rating) - 3) - Math.abs(Number(a.rating) - 3)) || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3);
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

  if (loading && !initialDataReady) {
    return <AdminSkeleton pageTitle={pageTitles[activeTab]} />;
  }

  return (
    <div className={`min-h-screen bg-cream flex flex-col md:flex-row ${['staff', 'faq', 'gallery', 'audit', 'inventory', 'payments'].includes(activeTab) ? 'h-dvh overflow-hidden' : ''}`}>
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

      <div className={`flex-1 flex flex-col overflow-hidden ${['staff', 'faq', 'gallery', 'audit', 'inventory', 'payments'].includes(activeTab) ? 'h-dvh min-h-0' : 'min-h-screen'}`}>
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} user={user} />

        <main className={`flex-1 min-h-0 min-w-0 p-3 sm:p-4 lg:p-5 scrollbar-thin ${['reports', 'staff', 'faq', 'gallery', 'audit', 'inventory', 'payments'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto'} ${['staff', 'faq', 'gallery', 'audit', 'inventory', 'payments'].includes(activeTab) ? 'flex flex-col' : ''}`}>
          {['staff', 'faq'].includes(activeTab) && (
            <h1 className="heading-page mb-4 shrink-0 text-espresso">{pageTitles[activeTab]}</h1>
          )}
          {receiptPrintError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl mb-6 flex items-start gap-3 shadow-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold leading-snug">Receipt Not Printed</p>
                <p className="text-xs text-amber-700/90 mt-1">{receiptPrintError}</p>
              </div>
              <button type="button" onClick={() => setReceiptPrintError('')} className="text-amber-700/70 hover:text-amber-900">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {dataError && activeTab !== 'analytics' && (
            <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-2xl mb-6 flex items-start gap-3 shadow-sm" role="alert">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="flex-1 text-xs font-semibold">{dataError}</p>
              <Button variant="outline" size="sm" onClick={() => fetchData()} className="border-red-200 bg-white text-red-800 hover:bg-red-100">Retry</Button>
            </div>
          )}

          {isActiveTabLoading && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-espresso/[0.08] bg-white px-4 py-3" role="status">
              <LoadingSpinner size="sm" className="text-gold-dark" label={`Loading ${pageTitles[activeTab]}`} />
              <span className="text-xs font-bold text-espresso/60">Loading {pageTitles[activeTab]}...</span>
            </div>
          )}

          {/* INSIGHTHUB DASHBOARD */}
          {activeTab === 'analytics' && (
            <div className="w-full space-y-4 animate-in-up" key="analytics">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-gold-dark font-black mb-1">CAV InsightHub</p>
                  <h1 className="heading-page text-espresso">Business Overview</h1>
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

              {analyticsError && (
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p className="flex-1 text-xs font-semibold">{analyticsError}</p>
                  <Button variant="outline" size="sm" onClick={() => fetchData()} className="border-red-200 bg-white text-red-800 hover:bg-red-100">Retry</Button>
                </div>
              )}
              {!analyticsError && !analyticsDataAvailable && (
                <p className="rounded-xl border border-espresso/10 bg-white px-4 py-3 text-xs font-semibold text-espresso/60" role="status">
                  {loading ? 'Loading Business Overview metrics…' : 'Waiting for metrics for the selected date range…'}
                </p>
              )}
              {analyticsDataAvailable && !hasDashboardOperationalRecords(analytics) && (
                <p className="rounded-xl border border-espresso/10 bg-white px-4 py-3 text-xs font-semibold text-espresso/60" role="status">
                  No operational records were found for {analytics.range.start === analytics.range.end ? analytics.range.start : `${analytics.range.start} to ${analytics.range.end}`} (Asia/Manila). All values below are calculated zeros for this range.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
                {[
                  {
                    label: 'Total Sales',
                    value: analyticsDataAvailable ? formatCurrency(metrics.total_revenue) : '—',
                    detail: analyticsDataAvailable
                      ? (metrics.total_revenue_change === null
                        ? 'New sales vs previous period'
                        : `${Math.abs(metrics.total_revenue_change)}% ${Number(metrics.total_revenue_change) >= 0 ? 'increase' : 'decrease'} vs previous period`)
                      : 'Waiting for verified results',
                    icon: DollarSign,
                    trend: Number(metrics.total_revenue_change || 0) >= 0 ? ArrowUpRight : ArrowDownRight,
                    trendClass: Number(metrics.total_revenue_change || 0) >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50',
                  },
                  {
                    label: 'Booking Income',
                    value: analyticsDataAvailable ? formatCurrency(metrics.booking_revenue) : '—',
                    detail: analyticsDataAvailable ? `${metrics.completed_bookings} completed bookings` : 'Waiting for verified results',
                    icon: Camera,
                    trend: ArrowUpRight,
                    trendClass: 'text-gold-dark bg-gold/10',
                  },
                  {
                    label: 'Total Bookings',
                    value: analyticsDataAvailable ? metrics.total_bookings : '—',
                    detail: analyticsDataAvailable ? `P ${metrics.pending} · C ${metrics.confirmed} · Done ${metrics.completed} · X ${metrics.cancelled}` : 'Waiting for verified results',
                    icon: ClipboardCheck,
                    trend: Calendar,
                    trendClass: 'text-blue-700 bg-blue-50',
                  },
                  {
                    label: 'POS Transactions',
                    value: analyticsDataAvailable ? metrics.transaction_count : '—',
                    detail: analyticsDataAvailable ? `${formatCurrency(metrics.avg_transaction_value)} avg · ${metrics.total_items_sold} items sold` : 'Waiting for verified results',
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
                        {inventorySummary.map(status => {
                          const SummaryCard = 'button';
                          return (
                          <SummaryCard
                            key={status.key}
                            type="button"
                            onClick={() => {
                              setSelectedInventoryStatus({ key: status.key, label: status.label });
                              setIngredientStatusOpen(true);
                            }}
                            aria-haspopup="dialog"
                            aria-label={`View ${status.value} ${status.label.toLocaleLowerCase()} ingredients`}
                            className="cursor-pointer rounded-2xl border border-espresso/[0.05] bg-cream/60 p-3 text-left transition hover:-translate-y-0.5 hover:border-gold/30 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gold/40"
                          >
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}>
                              {status.label}
                            </span>
                            <p className="font-sans text-2xl font-extrabold text-espresso mt-2">{status.value}</p>
                            <p className="text-[10px] text-espresso/45 uppercase font-black">ingredient{status.value === 1 ? '' : 's'}</p>
                          </SummaryCard>
                          );
                        })}
                      </div>
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                    <Card padding={false}>
                      <div className="p-5">
                        <CardHeader title="Revenue Sources" className="mb-4" />
                        {analyticsDataAvailable ? <div className="space-y-4">
                          {[
                            { label: 'POS Income', value: metrics.pos_revenue, color: 'bg-espresso/70' },
                            { label: 'Booking Income', value: metrics.booking_revenue, color: 'bg-gold' },
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
                        </div> : <p className="text-xs font-semibold text-espresso/55">Revenue sources are unavailable until valid metrics load.</p>}
                      </div>
                    </Card>

                    <Card padding={false}>
                      <div className="p-5">
                        <CardHeader title="Booking Status Summary" className="mb-3" />
                        {analyticsDataAvailable ? <div className="grid grid-cols-[120px_1fr] gap-4 items-center">
                          <div className="h-[120px]">
                            <DashboardChartBoundary resetKey={JSON.stringify(statusData)}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={36} outerRadius={54} paddingAngle={3}>
                                    {statusData.map(s => <Cell key={s.label} fill={s.color} />)}
                                  </Pie>
                                  <Tooltip />
                                </PieChart>
                              </ResponsiveContainer>
                            </DashboardChartBoundary>
                          </div>
                          <div className="space-y-2.5">
                            {statusData.map(status => (
                              <div key={status.label} className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 font-bold text-espresso"><span className="w-2.5 h-2.5 rounded-full" style={{ background: status.color }} />{status.label}</span>
                                <span className="font-black">{status.value}</span>
                              </div>
                            ))}
                          </div>
                        </div> : <p className="text-xs font-semibold text-espresso/55">Booking status counts are unavailable until valid metrics load.</p>}
                      </div>
                    </Card>
                  </div>

              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Next 7 Days',
                    value: forecastLoading ? 'Loading…' : forecastError ? 'Unavailable' : formatForecastAmount(next7Forecast),
                    detail: next7Summary.start_date ? `${formatForecastDate(next7Summary.start_date)} – ${formatForecastDate(next7Summary.end_date)}` : 'No forecast available',
                    icon: TrendingUp,
                    className: 'bg-gold/10 text-gold-dark border-gold/20',
                  },
                  {
                    label: 'Following Week',
                    value: forecastLoading ? 'Loading…' : forecastError ? 'Unavailable' : formatForecastAmount(nextWeekForecast),
                    detail: nextWeekSummary.start_date ? `${formatForecastDate(nextWeekSummary.start_date)} – ${formatForecastDate(nextWeekSummary.end_date)}` : 'No forecast available',
                    icon: DollarSign,
                    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  },
                  {
                    label: 'Backtest Reliability',
                    value: forecastLoading ? 'Loading…' : forecastError ? 'Unavailable' : !backtestAvailable ? 'N/A' : `${forecastAccuracy}%`,
                    detail: backtestAvailable ? `Held-out WAPE ${Number(forecastMetrics.wape).toLocaleString('en-PH', { style: 'percent', maximumFractionDigits: 1 })}` : forecastQualityMessage,
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

              {forecastError && (
                <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                  <span className="flex-1">Forecast unavailable: {forecastError}</span>
                  <Button size="sm" variant="outline" onClick={() => loadForecast({ force: true })}>Retry forecast</Button>
                </div>
              )}
              {!forecastLoading && !forecastError && forecast?.status === 'ok' && (
                <div className={`rounded-2xl border px-4 py-3 text-xs ${backtestAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <p className="font-black">{backtestAvailable ? 'Backtested forecast available' : 'Forecast available; backtest metrics unavailable'}</p>
                  <p className="mt-1 font-semibold opacity-80">{forecast?.data_sufficiency?.message}</p>
                  <p className="mt-1 opacity-70">Dataset: {forecast.data_quality?.dataset_type || (forecast.data_quality?.is_synthetic ? 'Synthetic sales data' : 'Imported sales data')} · Source: {forecast.source_file} · Imported {forecast.imported_at ? formatForecastDate(forecast.imported_at) : 'unknown'} · {forecast.data_quality?.valid_rows ?? '—'} valid rows · {forecast.data_quality?.history_days ?? '—'} calendar days.</p>
                </div>
              )}

              <div className="animate-in-up">
                <Card className="rounded-[24px]" padding={false}>
                  <div className="p-5 md:p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
                      <CardHeader title="Sales Analytics" subtitle={`${forecast?.history_start && forecast?.history_end ? `CSV actuals ${formatForecastDate(forecast.history_start)} – ${formatForecastDate(forecast.history_end)}` : 'Recorded sales'} · ${salesModel.display_name || 'Daily linear regression'}. Missing dates are marked in the tooltip.`} className="p-0" />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center rounded-2xl bg-cream px-3 py-2 text-[11px] font-black text-espresso/70 hover:text-espresso">
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          {salesHistoryFile ? salesHistoryFile.name : 'Choose sales CSV'}
                          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={event => setSalesHistoryFile(event.target.files?.[0] || null)} />
                        </label>
                        <Button size="sm" variant="outline" loading={salesHistoryUploadLoading} disabled={!salesHistoryFile} icon={Upload} onClick={handleSalesHistoryUpload}>
                          Import & Refresh
                        </Button>
                        {[
                          ['next_7_days', 'Next 7 days'],
                          ['next_week', 'Following week'],
                          ['upcoming_months', 'Upcoming months'],
                        ].map(([key, label]) => (
                          <button key={key} aria-pressed={forecastView === key} onClick={() => { setForecastView(key); setSalesChartGranularity(key === 'upcoming_months' ? 'monthly' : 'daily'); setSalesChartRange(null); }} className={`px-3 py-2 rounded-2xl text-[11px] font-black transition-all ${forecastView === key ? 'bg-espresso text-gold' : 'bg-cream text-espresso/60 hover:text-espresso'}`}>
                            {label}
                          </button>
                        ))}
                        {[
                          ['actual', 'Actual'],
                          ['forecast', 'Forecast'],
                          ['combined', 'Combined'],
                        ].map(([key, label]) => (
                          <button key={key} aria-pressed={visibleSeries[key]} onClick={() => setVisibleSeries(v => ({ ...v, [key]: !v[key] }))} className={`px-3 py-2 rounded-2xl text-[11px] font-black transition-all ${visibleSeries[key] ? 'bg-gold text-espresso' : 'bg-cream text-espresso/45'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-4 space-y-3 rounded-2xl border border-espresso/[0.06] bg-cream/45 p-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-[10px] font-black uppercase tracking-wider text-espresso/55">From
                          <input aria-label="Sales chart start date" type="date" min={salesChartDateLimits.min} max={salesChartDateLimits.max} value={salesChartStartDate} onChange={event => handleSalesChartDateChange(setSalesChartStartDate, event.target.value)} className="mt-1 block rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-semibold text-espresso" />
                        </label>
                        <label className="text-[10px] font-black uppercase tracking-wider text-espresso/55">To
                          <input aria-label="Sales chart end date" type="date" min={salesChartDateLimits.min} max={salesChartDateLimits.max} value={salesChartEndDate} onChange={event => handleSalesChartDateChange(setSalesChartEndDate, event.target.value)} className="mt-1 block rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-semibold text-espresso" />
                        </label>
                        <div className="flex flex-wrap gap-1" role="group" aria-label="Sales chart time interval">
                          {[
                            ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
                          ].map(([key, label]) => (
                            <button key={key} type="button" aria-pressed={salesChartGranularity === key} onClick={() => { setSalesChartGranularity(key); setSalesChartRange(null); }} className={`rounded-xl px-3 py-2 text-[11px] font-black ${salesChartGranularity === key ? 'bg-espresso text-gold' : 'bg-white text-espresso/60 hover:text-espresso'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <Button size="sm" variant="outline" onClick={resetSalesChartView}>Reset View</Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-espresso/55">
                          <span data-testid="sales-chart-visible-range">{visibleSalesChartData.length ? `${formatForecastDate(visibleSalesChartData[0].period_start || visibleSalesChartData[0].date)} – ${formatForecastDate(visibleSalesChartData[visibleSalesChartData.length - 1].period_end || visibleSalesChartData[visibleSalesChartData.length - 1].date)}` : 'No dates in selected range'}</span>
                        </span>
                        <span className="ml-auto text-[10px] font-semibold text-espresso/45">Scroll to zoom · Drag to pan.</span>
                      </div>
                    </div>
                    <div className="h-[360px] 2xl:h-[420px] w-full" aria-busy={forecastLoading || (!forecast && !forecastError)}>
                      {(forecastLoading || (!forecast && !forecastError)) && (
                        <div className="h-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-cream/60" role="status">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-48 w-[85%] rounded-xl" />
                          <span className="sr-only">Loading forecast data</span>
                        </div>
                      )}
                      {forecastChartData.length > 0 ? (
                        <div className="flex h-full min-h-0 flex-col">
                          <div
                            className={`min-h-0 flex-1 touch-none select-none ${salesChartDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                            ref={salesChartInteractionElementRef}
                            data-testid="sales-chart-interaction-area"
                            onMouseDown={handleSalesChartMouseDown}
                            onMouseMove={handleSalesChartMouseMove}
                            onMouseUp={handleSalesChartMouseEnd}
                            style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
                          >
                            <DashboardChartBoundary resetKey={`${forecastView}:${visibleSalesChartData.length}:${visibleSeries.actual}:${visibleSeries.forecast}:${visibleSeries.combined}`}>
                              <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={visibleSalesChartData} margin={{ top: 12, right: 20, left: 12, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5ECE1" />
                                  <XAxis dataKey="date" stroke="#2E1A11" fontSize={10} tickLine={false} minTickGap={22} interval="preserveStartEnd" tickFormatter={formatForecastDate} />
                                  <YAxis domain={salesYAxisDomain} allowDataOverflow stroke="#2E1A11" fontSize={10} tickLine={false} axisLine={false} width={95} tickFormatter={formatCurrency} />
                                  <Tooltip content={<SalesForecastTooltip />} />
                                  <Legend wrapperStyle={{ fontSize: 11 }} />
                                  {visibleSeries.actual && <Line type="monotone" dataKey="actual_sales" name="Actual Sales" stroke="#2E1A11" strokeWidth={3} dot={false} connectNulls={false} />}
                                  {visibleSeries.forecast && <Line type="monotone" dataKey="forecast_sales" name="ML Forecast" stroke="#D4AF37" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: '#D4AF37' }} connectNulls={false} />}
                                  {visibleSeries.combined && <Line type="monotone" dataKey="combined_sales" name="Combined Actual + Forecast" stroke="#3B82F6" strokeWidth={2.5} dot={false} connectNulls />}
                                </ComposedChart>
                              </ResponsiveContainer>
                            </DashboardChartBoundary>
                          </div>
                        </div>
                      ) : (forecast || forecastError) ? (
                        <EmptyState icon={BarChart2} title={salesChartStartDate || salesChartEndDate ? 'No sales in selected date range' : 'No sales or forecast data'} description="Adjust the date filters or reset the graph view to inspect available sales." />
                      ) : null}
                    </div>
                  </div>
                </Card>
              </div>

              <Card padding={false} className="rounded-[24px]">
                <div className="p-5 md:p-6">
                  <CardHeader title="Linear regression: How it works" subtitle="The imported daily sales are sorted by date; x is elapsed calendar days and y is daily sales in PHP." className="mb-4" />
                  {trainingComputation.sample_count ? <>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <p><b>Training n:</b> {trainingComputation.sample_count}</p>
                      <p><b>Σx:</b> {Number(trainingComputation.sum_x).toLocaleString()}</p>
                      <p><b>Σy:</b> {formatCurrency(trainingComputation.sum_y)}</p>
                      <p><b>Σx²:</b> {Number(trainingComputation.sum_x2).toLocaleString()}</p>
                      <p><b>Σxy:</b> {Number(trainingComputation.sum_xy).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                      <p><b>Training slope m:</b> {Number(trainingComputation.slope).toFixed(10)}</p>
                      <p><b>Training intercept b:</b> {formatCurrency(trainingComputation.intercept)}</p>
                      <p><b>Holdout days:</b> {forecastMetrics.holdout_days ?? '—'}</p>
                    </div>
                    <div className="mt-4 space-y-2 rounded-2xl bg-cream/70 p-4 text-xs text-espresso/75">
                      <p>ŷ = mx + b</p>
                      <p>m = [nΣxy − (Σx)(Σy)] / [nΣx² − (Σx)²]</p>
                      <p>b = (Σy − mΣx) / n</p>
                      <p><b>Worked slope:</b> m = [{trainingComputation.sample_count} × {Number(trainingComputation.sum_xy).toLocaleString()} − {Number(trainingComputation.sum_x).toLocaleString()} × {Number(trainingComputation.sum_y).toLocaleString()}] / [{trainingComputation.sample_count} × {Number(trainingComputation.sum_x2).toLocaleString()} − {Number(trainingComputation.sum_x).toLocaleString()}²] = {Number(trainingComputation.slope).toFixed(10)}.</p>
                      <p><b>Holdout:</b> {forecast.sales_backtest?.length ? `${formatForecastDate(forecast.sales_backtest[0].date)} actual ${formatCurrency(forecast.sales_backtest[0].actual_sales)}; predicted ${formatCurrency(forecast.sales_backtest[0].predicted_sales)}.` : 'No held-out predictions are available.'}</p>
                      <p><b>Future fit:</b> Refit on all {finalComputation.sample_count ?? '—'} daily values, then evaluate ŷ at dates after {formatForecastDate(forecast.history_end)}. First forecast: {forecast.sales_forecast?.length ? `${formatForecastDate(forecast.sales_forecast[0].target_date)} · ${formatCurrency(forecast.sales_forecast[0].predicted_sales)}` : 'unavailable'}.</p>
                    </div>
                    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-xs"><thead className="bg-cream text-espresso/60"><tr>{['Model / baseline', 'MAE (PHP)', 'RMSE (PHP)', 'R²', 'WAPE'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
                      <tr className="border-t border-espresso/5"><td className="p-2 font-bold">Linear regression</td><td className="p-2">{formatForecastAmount(finiteForecastValue(forecastMetrics.mae))}</td><td className="p-2">{formatForecastAmount(finiteForecastValue(forecastMetrics.rmse))}</td><td className="p-2">{finiteForecastValue(forecastMetrics.r2)?.toFixed(4) ?? 'N/A'}</td><td className="p-2">{finiteForecastValue(forecastMetrics.wape) == null ? 'N/A' : Number(forecastMetrics.wape).toLocaleString('en-PH', { style: 'percent', maximumFractionDigits: 1 })}</td></tr>
                      {forecastMetrics.baseline && <tr className="border-t border-espresso/5"><td className="p-2 font-bold">Training mean baseline</td><td className="p-2">{formatForecastAmount(finiteForecastValue(forecastMetrics.baseline.mae))}</td><td className="p-2">{formatForecastAmount(finiteForecastValue(forecastMetrics.baseline.rmse))}</td><td className="p-2">{finiteForecastValue(forecastMetrics.baseline.r2)?.toFixed(4) ?? 'N/A'}</td><td className="p-2">{finiteForecastValue(forecastMetrics.baseline.wape) == null ? 'N/A' : Number(forecastMetrics.baseline.wape).toLocaleString('en-PH', { style: 'percent', maximumFractionDigits: 1 })}</td></tr>}
                    </tbody></table></div>
                    <p className="mt-3 text-xs text-espresso/55">Linear regression models a trend and may miss seasonality. This source is synthetic; its backtest does not establish real-world accuracy.</p>
                  </> : <p className="rounded-xl bg-cream/70 p-4 text-sm text-espresso/60">Training details appear after validated CSV records reach the model.</p>}
                </div>
              </Card>

              <div className="animate-in-up">
                <Card className="rounded-[24px]" padding={false}>
                  <div className="p-5 md:p-6">
                    <CardHeader title="Product Forecast" subtitle={`Next 7 days · ${productForecastSummary.length ? 'sales allocated from transaction totals by item quantity' : 'No parsed product history available'}`} className="mb-4" />
                    <div className="h-[320px] w-full">
                      {productForecastSummary.length > 0 ? (
                        <DashboardChartBoundary resetKey={JSON.stringify(productForecastSummary)}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={productForecastSummary.slice(0, 20)} layout="vertical" margin={{ top: 4, right: 20, left: 12, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F5ECE1" />
                              <XAxis type="number" stroke="#2E1A11" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `PHP ${Math.round(Number(value || 0) / 1000)}k`} />
                              <YAxis type="category" dataKey="product_name" width={150} stroke="#2E1A11" fontSize={10} tickLine={false} axisLine={false} />
                              <Tooltip formatter={(value) => [formatCurrency(value), 'Predicted sales']} />
                              <Bar dataKey="predicted_sales" name="Predicted sales" fill="#D4AF37" radius={[0, 7, 7, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </DashboardChartBoundary>
                      ) : (
                        <EmptyState icon={ShoppingBag} title="No product forecast data" description="The sales CSV does not contain parseable product history yet." />
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
                  <h1 className="heading-page text-espresso">Booking Calendar</h1>
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

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
                <div className="min-w-0 rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
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

                <div className="flex min-w-0 flex-col gap-4">
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

                  <form onSubmit={handleCreateStudioUnavailable} className="space-y-3 rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
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
                </div>
              </div>

              <div className="min-w-0 rounded-[20px] border border-espresso/[0.08] bg-white p-4 shadow-sm">
                <CardHeader title="Live Bookings" subtitle="Studio sessions and off-site event photoshoots for this month." className="mb-3" />
                <div className="grid min-w-0 grid-cols-1 gap-3">
                  {calendarMonthBookings.length ? calendarMonthBookings.map(booking => (
                    <div key={booking.id} className="min-w-0 rounded-2xl border border-espresso/10 bg-cream/40 p-4 text-xs sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Booking</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${isEventBooking(booking) ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                {isEventBooking(booking) ? 'Off-site Event' : 'Studio Session'}
                              </span>
                              <StatusBadge status={booking.status} />
                            </div>
                            <p className="mt-2 break-words font-black text-espresso">Booking #{booking.id}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Customer</p>
                            <p className="break-words font-bold text-espresso/75">{getCalendarBookingName(booking)}</p>
                            {booking.customer?.email && <p className="mt-1 break-all text-espresso/60">{booking.customer.email}</p>}
                            {booking.customer?.phone_number && <p className="mt-1 text-espresso/60">{booking.customer.phone_number}</p>}
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Schedule</p>
                            <p className="font-bold text-espresso/75">{booking.scheduled_date || 'Date not set'}</p>
                            <p className="mt-1 font-bold text-espresso/60">{String(booking.scheduled_time || '').slice(0, 5) || 'Time not set'}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Package</p>
                            <p className="break-words font-bold text-espresso/75">{booking.package_details?.name || 'Booking package'}</p>
                            {booking.package_details?.price != null && <p className="mt-1 font-bold text-espresso/60">{formatCurrency(booking.package_details.price)}</p>}
                            {booking.required_down_payment != null && <p className="mt-1 text-espresso/55">Down payment: {formatCurrency(booking.required_down_payment)}</p>}
                            {booking.package_details?.inclusions && <p className="mt-1 break-words leading-relaxed text-espresso/55">Includes: {booking.package_details.inclusions}</p>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 sm:w-40 sm:flex-col sm:items-stretch">
                          <select
                            aria-label={`Booking ${booking.id} status`}
                            value={booking.status}
                            onChange={e => handleCalendarBookingStatus(booking, e.target.value)}
                            className="min-w-0 flex-1 rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-bold text-espresso focus:outline-none focus:ring-4 focus:ring-gold/15 sm:w-full"
                          >
                            {calendarBookingStatusOptions.map(option => (
                              <option key={option} value={option}>{option.replace('_', ' ')}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleDeleteBooking({ ...booking, customer_name: getCalendarBookingName(booking) })}
                            className="shrink-0 rounded-lg p-2 text-red-500 hover:bg-red-50"
                            aria-label={`Delete booking ${booking.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {(booking.items?.length > 0 || booking.notes || booking.payments?.length > 0) && (
                        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-espresso/10 pt-3 md:grid-cols-2">
                          {booking.items?.length > 0 && (
                            <div className="min-w-0">
                              <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Booking items</p>
                              <p className="break-words font-bold leading-relaxed text-espresso/65">
                                {booking.items.map(item => `${item.name || 'Item'}${item.quantity ? ` × ${item.quantity}` : ''}${item.price != null ? ` · ${formatCurrency(item.price)}` : ''}`).join(', ')}
                              </p>
                            </div>
                          )}
                          {booking.notes && (
                            <div className="min-w-0">
                              <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Notes</p>
                              <p className="whitespace-pre-wrap break-words font-medium leading-relaxed text-espresso/65">{booking.notes}</p>
                            </div>
                          )}
                          {booking.payments?.length > 0 && (
                            <div className="min-w-0">
                              <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Payment submissions</p>
                              <div className="space-y-1">
                                {booking.payments.map(payment => (
                                  <p key={payment.id || payment.reference_number} className="break-words font-medium leading-relaxed text-espresso/65">
                                    {formatCurrency(payment.amount)} · {payment.method_label || payment.method || 'Payment'} · {String(payment.status || 'Pending').replace(/_/g, ' ')}
                                    {payment.reference_number ? ` · Ref ${payment.reference_number}` : ''}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
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
                  <h1 className="heading-page text-espresso">End-of-Day Reports</h1>
                  <p className="text-xs text-espresso/50 mt-1">Print shift closeout reports and reprint saved records.</p>
                </div>
                <Button variant="gold" size="sm" icon={Printer} onClick={() => openEndOfDayModal()}>
                  Prepare Closeout Report
                </Button>
              </div>

              <div className="shrink-0 flex flex-col gap-2 rounded-xl border border-espresso/10 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <p className={`text-xs font-bold ${/failed|not found|no printer/i.test(localPrintStatus) ? 'text-amber-700' : 'text-espresso/65'}`}>
                  {localPrintStatus}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    aria-label="Local closeout printer"
                    value={selectedLocalPrinter}
                    onChange={event => setSelectedLocalPrinter(event.target.value)}
                    disabled={localPrinterLoading || !localPrinters.length}
                    className="h-9 min-w-0 rounded-lg border border-espresso/10 bg-cream px-2 text-xs font-bold text-espresso outline-none focus:ring-4 focus:ring-gold/15 sm:w-52"
                  >
                    {localPrinters.length ? localPrinters.map(printer => (
                      <option key={printer.name} value={printer.name}>{printer.name}{printer.default ? ' (Default)' : ''}</option>
                    )) : <option value="">No printers detected</option>}
                  </select>
                  <Button variant="outline" size="sm" icon={Printer} onClick={handleDetectLocalPrinters} loading={localPrinterLoading} disabled={localPrinterLoading}>
                    Detect Printers
                  </Button>
                </div>
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
                      <div key={report.id} className="flex flex-col gap-4 rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm transition hover:border-gold/30 hover:shadow-md xl:flex-row xl:items-center xl:justify-between">
                        <button
                          type="button"
                          onClick={() => handleOpenSavedEndOfDayReport(report)}
                          aria-label={`View saved closeout for ${report.report_date}`}
                          className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                        >
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
                          <span className="mt-3 inline-flex text-[10px] font-black uppercase tracking-wider text-gold-dark">View report details</span>
                        </button>
                        <Button variant="outline" size="sm" icon={Printer} onClick={() => handleReprintEndOfDayReport(report)} loading={endOfDayReprintingId === report.id} disabled={endOfDayReprintingId !== null}>
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
            <div className="flex min-h-0 w-full flex-1 flex-col gap-3 animate-in-up" key="payments">
              <div className="grid shrink-0 grid-cols-3 gap-2">
                {[
                  ['Pending Verification', paymentStatusCounts.PENDING_VERIFICATION || 0, 'bg-amber-50 text-amber-700 border-amber-200'],
                  ['Approved', paymentStatusCounts.APPROVED || 0, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
                  ['Rejected', paymentStatusCounts.REJECTED || 0, 'bg-red-50 text-red-700 border-red-200'],
                ].map(([label, value, className]) => (
                  <div key={label} className={`rounded-2xl border px-3 py-2.5 shadow-sm ${className}`}>
                    <p className="text-[9px] uppercase tracking-[0.16em] font-black opacity-80">{label}</p>
                    <p className="text-2xl font-black leading-tight mt-1">{value}</p>
                  </div>
                ))}
              </div>

              <Card padding={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4 md:p-5">
                  <CardHeader
                    title="Booking Payment Verification"
                    subtitle="Review the booking details, then match the reference number and amount with the selected payment provider before approving."
                    className="mb-2 shrink-0 gap-2 sm:flex-col sm:items-start"
                  />
                  <div role="group" aria-label="Booking payment status filter" className="mb-3 flex shrink-0 gap-1 overflow-x-auto rounded-xl bg-cream/70 p-1 scrollbar-thin">
                    {[
                      ['ALL', 'All'],
                      ['PENDING_VERIFICATION', 'Pending Verification'],
                      ['APPROVED', 'Approved'],
                      ['REJECTED', 'Rejected'],
                    ].map(([value, label]) => {
                      const active = paymentStatusFilter === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setPaymentStatusFilter(value);
                            setPaymentPage(1);
                            if (paymentListRef.current) paymentListRef.current.scrollTop = 0;
                          }}
                          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-black transition-colors sm:text-xs ${active ? 'bg-espresso text-gold shadow-sm' : 'text-espresso/60 hover:bg-white hover:text-espresso'}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                <div ref={paymentListRef} aria-label="Booking payment list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 scrollbar-thin">
                {filteredBookingPayments.length > 0 ? <div className="space-y-2 pb-1">
                    {paymentPageRows.map((payment, i) => {
                      const details = payment.booking_details || {};
                      const isPending = payment.status === 'PENDING_VERIFICATION';
                      return (
                        <div key={payment.id} className="overflow-hidden rounded-2xl border border-espresso/10 bg-white shadow-sm animate-in-up" style={{ animationDelay: `${i * 35}ms` }}>
                          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-espresso/[0.07] bg-cream/35 px-3 py-2.5 md:px-4">
                            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                              <Avatar user={{ username: details.customer_name, email: details.customer_email, profile_picture_url: details.customer_profile_picture_url }} size="sm" />
                              <p className="min-w-0 font-black text-espresso">{details.customer_name || 'N/A'}</p>
                              <StatusBadge status={payment.status} />
                            </div>
                            <p className="text-xs font-black uppercase tracking-wide text-espresso/65">Booking <span className="text-espresso">#{payment.booking}</span></p>
                          </div>

                          <div className="grid grid-cols-1 gap-3 px-3 py-3 text-xs sm:grid-cols-2 md:grid-cols-3 md:gap-0 md:px-4">
                            <section className="min-w-0 md:pr-4">
                              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-gold-dark">Booking Details</h3>
                              <dl className="space-y-1.5">
                                <div><dt className="inline text-espresso/50">Package: </dt><dd className="inline font-bold text-espresso">{details.service_name ? `${details.service_name} · ` : ''}{details.package_name || details.package_details?.name || 'N/A'}</dd></div>
                                <div><dt className="inline text-espresso/50">Schedule: </dt><dd className="inline font-bold text-espresso">{details.scheduled_date} at {details.scheduled_time}</dd></div>
                                <div className="min-w-0"><dt className="inline text-espresso/50">Email: </dt><dd className="break-all font-bold text-espresso">{details.customer_email || 'No email'}</dd></div>
                              </dl>
                            </section>

                            <section className="min-w-0 border-t border-espresso/10 pt-3 sm:border-t-0 sm:pt-0 md:border-l md:border-t-0 md:px-4 md:pt-0">
                              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-gold-dark">Payment Details</h3>
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                <div className="min-w-0"><dt className="text-espresso/50">Method</dt><dd className="break-words font-bold text-espresso">{payment.method_label || payment.method || 'Unknown'}</dd></div>
                                <div className="min-w-0"><dt className="text-espresso/50">Reference</dt><dd className="break-all font-bold text-espresso">{payment.reference_number}</dd></div>
                                <div><dt className="text-espresso/50">Amount Paid</dt><dd className="font-black text-gold-dark">{formatCurrency(payment.amount)}</dd></div>
                                <div><dt className="text-espresso/50">Required DP</dt><dd className="font-bold text-espresso">{formatCurrency(payment.required_down_payment)}</dd></div>
                                <div className="col-span-2"><dt className="inline text-espresso/50">Paid At: </dt><dd className="inline font-bold text-espresso">{formatManilaDateTime(payment.paid_at)}</dd></div>
                                <div className="col-span-2 pt-0.5"><PaymentProofPreview payment={payment} /></div>
                              </dl>
                            </section>

                            <section className="min-w-0 border-t border-espresso/10 pt-3 sm:col-span-2 md:col-span-1 md:border-l md:border-t-0 md:px-4 md:pt-0">
                              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-gold-dark">Verification</h3>
                              <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
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
                                <div className="text-xs text-espresso/60">
                                  <p className="font-black text-espresso">Verified by</p>
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <Avatar user={payment.verified_by_details} size="xs" />
                                    <p>{payment.verified_by_details?.username || 'N/A'}</p>
                                  </div>
                                  <p>{payment.verified_at ? formatManilaDateTime(payment.verified_at) : 'No timestamp'}</p>
                                </div>
                              )}
                              </div>
                            </section>
                            </div>
                        </div>
                      );
                    })}
                </div> : (
                  <EmptyState icon={CreditCard} title="No payments found" description="Submitted booking payments will appear here for verification." />
                )}
                </div>
                {filteredBookingPayments.length > 0 && (
                  <div className="mt-2 shrink-0 border-t border-espresso/[0.06] pt-2">
                    <PaginationControls page={paymentPage} setPage={setPaymentPage} total={filteredBookingPayments.length} pageSize={paymentPageSize} setPageSize={setPaymentPageSize} />
                  </div>
                )}
                </div>
              </Card>
            </div>
          )}

          {/* ACCOUNTS */}
          {activeTab === 'staff' && (
            <div className="flex min-h-0 w-full flex-1 flex-col animate-in-up" key="staff">
              <Modal
                open={createAccountOpen}
                onClose={() => {
                  if (creatingStaff) return;
                  setCreateAccountOpen(false);
                  setNewStaffErrors({});
                }}
                title="Add Account"
                size="lg"
              >
                  <form onSubmit={handleCreateStaff} className="space-y-4">
                    <Input
                      label="Username"
                      required
                      value={newAccountForm.username}
                      onChange={e => { setNewAccountForm(current => ({ ...current, username: e.target.value })); setNewStaffErrors(current => ({ ...current, username: '' })); }}
                      placeholder="username"
                      disabled={creatingStaff}
                      error={newStaffErrors.username}
                    />
                    <Input
                      label="Password"
                      type="password"
                      required
                      value={newAccountForm.password}
                      onChange={e => { setNewAccountForm(current => ({ ...current, password: e.target.value })); setNewStaffErrors(current => ({ ...current, password: '' })); }}
                      placeholder="password"
                      disabled={creatingStaff}
                      error={newStaffErrors.password}
                    />
                    <PasswordStrength password={newAccountForm.password} />
                    <Select
                      label="Role"
                      value={newAccountForm.role}
                      onChange={e => setNewAccountForm(current => ({ ...current, role: e.target.value }))}
                      disabled={creatingStaff}
                      options={[
                        { value: 'STAFF', label: 'Regular Staff' },
                        { value: 'ADMIN', label: 'Super Administrator' },
                        { value: 'CUSTOMER', label: 'Customer Profile' },
                      ]}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="First Name"
                        required={newAccountForm.role === 'CUSTOMER'}
                        value={newAccountForm.first_name}
                        onChange={e => { setNewAccountForm(current => ({ ...current, first_name: e.target.value })); setNewStaffErrors(current => ({ ...current, first_name: '' })); }}
                        disabled={creatingStaff}
                        error={newStaffErrors.first_name}
                      />
                      <Input
                        label="Last Name"
                        required={newAccountForm.role === 'CUSTOMER'}
                        value={newAccountForm.last_name}
                        onChange={e => { setNewAccountForm(current => ({ ...current, last_name: e.target.value })); setNewStaffErrors(current => ({ ...current, last_name: '' })); }}
                        disabled={creatingStaff}
                        error={newStaffErrors.last_name}
                      />
                    </div>
                    <Input
                      label="Email"
                      type="email"
                      required={newAccountForm.role === 'CUSTOMER'}
                      value={newAccountForm.email}
                      onChange={e => { setNewAccountForm(current => ({ ...current, email: e.target.value })); setNewStaffErrors(current => ({ ...current, email: '' })); }}
                      placeholder="account@cav.com"
                      disabled={creatingStaff}
                      error={newStaffErrors.email}
                    />
                    <Input
                      label="Phone Number"
                      type="tel"
                      required={newAccountForm.role === 'CUSTOMER'}
                      value={newAccountForm.phone_number}
                      onChange={e => { setNewAccountForm(current => ({ ...current, phone_number: e.target.value })); setNewStaffErrors(current => ({ ...current, phone_number: '' })); }}
                      disabled={creatingStaff}
                      error={newStaffErrors.phone_number}
                    />
                    <Textarea
                      label="Address"
                      required={newAccountForm.role === 'CUSTOMER'}
                      rows={3}
                      value={newAccountForm.address}
                      onChange={e => { setNewAccountForm(current => ({ ...current, address: e.target.value })); setNewStaffErrors(current => ({ ...current, address: '' })); }}
                      disabled={creatingStaff}
                      error={newStaffErrors.address}
                    />
                    <Button type="submit" variant="primary" className="w-full" icon={Plus} loading={creatingStaff} disabled={creatingStaff || !newStaffFormValid}>
                      Create Account
                    </Button>
                  </form>
              </Modal>

                <Card className="!p-4 md:!p-5 flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                  <CardHeader
                    title="Existing Accounts"
                    className="mb-3 shrink-0"
                    action={(
                      <IconButton
                        icon={Plus}
                        label="Add account"
                        title="Add account"
                        variant="gold"
                        onClick={() => {
                          setNewAccountForm(emptyAccountForm());
                          setNewStaffErrors({});
                          setCreateAccountOpen(true);
                        }}
                      />
                    )}
                  />
                  <div className="mb-3 flex shrink-0 flex-col gap-3">
                    <label className="relative block min-w-0">
                      <span className="sr-only">Search accounts</span>
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-espresso/40" aria-hidden="true" />
                      <input
                        type="search"
                        aria-label="Search accounts"
                        value={staffSearch}
                        onChange={event => {
                          setStaffSearch(event.target.value);
                          setStaffPage(1);
                        }}
                        placeholder="Search username, name, email, phone, or address"
                        className="h-10 w-full min-w-0 rounded-xl border border-espresso/10 bg-white pl-10 pr-3 text-xs font-semibold text-espresso placeholder:text-espresso/40 focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/15"
                      />
                    </label>
                    <div role="group" aria-label="Filter accounts by role" className="flex flex-wrap gap-2">
                      {staffRoleFilterOptions.map(option => {
                        const count = option.value === 'ALL' ? staffList.length : staffRoleCounts[option.value] || 0;
                        const selected = staffRoleFilter === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              setStaffRoleFilter(option.value);
                              setStaffPage(1);
                            }}
                            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${selected ? 'border-gold bg-gold/15 text-espresso' : 'border-espresso/10 bg-white text-espresso/60 hover:border-gold/40 hover:text-espresso'}`}
                          >
                            <span>{option.label}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${selected ? 'bg-white/80 text-espresso' : 'bg-cream text-espresso/55'}`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div ref={staffTableAreaRef} className="min-h-0 flex-1">
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
                        {
                          key: 'name',
                          label: 'Name',
                          render: st => `${st.first_name || ''} ${st.last_name || ''}`.trim() || 'Not provided',
                        },
                        {
                          key: 'contact',
                          label: 'Contact',
                          render: st => (
                            <div className="min-w-[170px] text-xs leading-relaxed text-espresso/70">
                              <p className="break-all">{st.email || 'No email'}</p>
                              <p>{st.phone_number || 'No phone'}</p>
                            </div>
                          ),
                        },
                        { key: 'address', label: 'Address', render: st => <span className="block max-w-[180px] truncate" title={st.address || ''}>{st.address || 'Not provided'}</span> },
                        {
                          key: 'registration_method',
                          label: 'Registered Via',
                          render: st => ({
                            FORM: 'Registration Form',
                            GOOGLE: 'Google',
                            ADMIN: 'Admin',
                            LEGACY: 'Existing Account',
                          }[st.registration_method] || 'Existing Account'),
                        },
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
                      minWidth={1080}
                      containerClassName="h-full"
                      emptyIcon={Users}
                      emptyTitle={staffList.length > 0 ? 'No matching accounts' : 'No accounts found'}
                      emptyDescription={staffList.length > 0
                        ? 'No accounts match the selected role and search. Adjust the filters or clear them to see all accounts.'
                        : 'Use the add account button to create the first account.'}
                      emptyStateClassName="!py-4"
                      emptyStateAction={staffList.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStaffRoleFilter('ALL');
                            setStaffSearch('');
                            setStaffPage(1);
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                      showEmptyTable
                    />
                    </div>
                    <PaginationControls page={staffPage} setPage={setStaffPage} total={filteredStaffList.length} pageSize={staffPageSize} alwaysVisible compact />
                  </div>
                </Card>
            </div>
          )}

          {/* FAQ MANAGER */}
          {activeTab === 'faq' && (
            <div className="grid min-h-0 w-full flex-1 grid-cols-1 grid-rows-2 gap-4 animate-in-up xl:grid-cols-12 xl:grid-rows-1" key="faq">
              <div className="min-h-0 xl:col-span-4">
                <Card className="!p-4 md:!p-5 flex h-full min-h-0 flex-col overflow-hidden">
                  <CardHeader title={editingFaq ? 'Update FAQ Entry' : 'Add FAQ Entry'} className="mb-3 shrink-0" />
                  <form onSubmit={handleFAQSubmit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin">
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
                      containerClassName="flex min-h-0 flex-1 flex-col"
                      className="min-h-[5rem] flex-1"
                      disabled={faqSaving}
                      error={faqErrors.answer}
                    />
                    <Input label="Tags / Keywords" value={faqTags} onChange={e => setFaqTags(e.target.value)} placeholder="e.g. card, payment, visa" disabled={faqSaving} />
                    <div className="mt-auto flex shrink-0 gap-2">
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

              <div className="min-h-0 xl:col-span-8">
                <Card className="!p-4 md:!p-5 flex h-full min-h-0 flex-col overflow-hidden">
                  <CardHeader title="Knowledge Base FAQs" subtitle="RAG-powered question bank" className="mb-3 shrink-0" />
                  {faqs.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
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
                    <div className="shrink-0">
                      <PaginationControls page={faqPage} setPage={setFaqPage} total={faqs.length} pageSize={faqPageSize} setPageSize={setFaqPageSize} />
                    </div>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <EmptyState icon={MessageSquare} title="No FAQs yet" description="Add your first FAQ entry to power the chatbot." />
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* REVIEWS & FEEDBACK */}
          {activeTab === 'reviews' && (
            <div className="w-full space-y-4 animate-in-up" key="reviews">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.24em] text-gold-dark">Customer Voice</p>
                <h1 className="heading-page text-espresso">Reviews &amp; Feedback</h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-espresso/55">
                  See what customers are saying about their completed studio sessions.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'All reviews', value: reviews.length, icon: MessageSquare, className: 'text-espresso' },
                  { label: 'Positive', value: reviewCounts.Positive || 0, icon: ThumbsUp, className: 'text-emerald-600' },
                  { label: 'Neutral', value: reviewCounts.Neutral || 0, icon: Minus, className: 'text-amber-600' },
                  { label: 'Negative', value: reviewCounts.Negative || 0, icon: ThumbsDown, className: 'text-red-600' },
                ].map(({ label, value, icon: Icon, className }) => (
                  <Card key={label} className="!p-3.5 md:!p-4">
                    <div className={`mb-2 flex items-center gap-2 text-xs font-bold ${className}`}>
                      <Icon className="h-4 w-4" /> {label}
                    </div>
                    <p className="text-2xl font-black text-espresso">{value}</p>
                  </Card>
                ))}
              </div>

              {keyComments.length > 0 && (
                <Card className="!p-4 md:!p-5">
                  <CardHeader title="Key comments" />
                  <div className="grid gap-3 lg:grid-cols-3">
                    {keyComments.map(review => (
                      <div key={review.id} className="rounded-2xl border border-gold/20 bg-gold/5 p-4">
                        <Quote className="mb-2 h-4 w-4 text-gold-dark" />
                        <p className="line-clamp-4 text-sm font-semibold leading-relaxed text-espresso/80">
                          “{review.feedback || review.suggestions}”
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-bold text-espresso/50">
                          <span className="truncate">{review.customer_details?.name || 'Customer'}</span>
                          <span className="shrink-0 text-gold-dark">{review.rating}/5</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="!p-4 md:!p-5">
                <CardHeader title="All customer reviews" />
                {reviewPageRows.length > 0 ? (
                  <>
                    <div className="space-y-3">
                      {reviewPageRows.map((review, index) => {
                        const booking = review.booking_details || {};
                        const sentimentStyles = {
                          Positive: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                          Neutral: 'border-amber-200 bg-amber-50 text-amber-700',
                          Negative: 'border-red-200 bg-red-50 text-red-700',
                        };
                        return (
                          <article key={review.id} className="rounded-2xl border border-espresso/[0.06] bg-cream/55 p-4 animate-in-up" style={{ animationDelay: `${index * 40}ms` }}>
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-black text-espresso">{review.customer_details?.name || 'Customer'}</p>
                                  <span className="text-[10px] text-espresso/45">{review.customer_details?.email}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-espresso/55">
                                  <span className="font-bold">Booking #{booking.id}</span>
                                  <span>•</span>
                                  <span>{booking.package}</span>
                                  <span>•</span>
                                  <span>{booking.scheduled_date} at {booking.scheduled_time}</span>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <div className="flex items-center gap-0.5 text-gold-dark" aria-label={`${review.rating} out of 5 stars`}>
                                  {Array.from({ length: 5 }, (_, star) => <Star key={star} className={`h-4 w-4 ${star < review.rating ? 'fill-current' : ''}`} />)}
                                </div>
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${sentimentStyles[review.sentiment] || sentimentStyles.Neutral}`}>
                                  {review.sentiment || 'Neutral'}
                                </span>
                              </div>
                            </div>
                            {review.feedback ? <p className="mt-4 text-sm leading-relaxed text-espresso/75">{review.feedback}</p> : <p className="mt-4 text-xs italic text-espresso/40">No written feedback provided.</p>}
                            {review.suggestions && (
                              <p className="mt-2 border-l-2 border-gold/40 pl-3 text-xs leading-relaxed text-espresso/60"><span className="font-black text-espresso/70">Suggestion:</span> {review.suggestions}</p>
                            )}
                            <p className="mt-3 text-[10px] font-semibold text-espresso/40">Submitted {formatManilaDateTime(review.created_at)}</p>
                          </article>
                        );
                      })}
                    </div>
                    <PaginationControls page={reviewPage} setPage={setReviewPage} total={reviews.length} pageSize={reviewPageSize} setPageSize={setReviewPageSize} />
                  </>
                ) : (
                  <EmptyState icon={Star} title="No reviews yet" description="Customer reviews will appear here after completed bookings are submitted." />
                )}
              </Card>
            </div>
          )}

          {activeTab === 'gallery' && <GalleryManager />}

          {activeTab === 'audit' && <AuditLogsPage />}
          {activeTab === 'inventory' && (
            <LiveInventoryPage
              ingredients={inventoryIngredients}
              productSalesInventory={productSalesInventory}
              loading={Boolean(tabLoading.inventory)}
              onRefresh={() => loadAdminTabData('inventory', { force: true })}
            />
          )}

        </main>
      </div>

      <Modal
        open={!!editingStaff}
        onClose={() => {
          if (staffSaving) return;
          setEditingStaff(null);
          setEditStaffErrors({});
        }}
        title="Edit Account"
        size="lg"
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
            required={editStaffForm.role === 'CUSTOMER'}
            value={editStaffForm.email}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, email: e.target.value }));
              setEditStaffErrors(current => ({ ...current, email: '' }));
            }}
            disabled={staffSaving}
            error={editStaffErrors.email}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="First Name"
              required={editStaffForm.role === 'CUSTOMER'}
              value={editStaffForm.first_name}
              onChange={e => {
                setEditStaffForm(current => ({ ...current, first_name: e.target.value }));
                setEditStaffErrors(current => ({ ...current, first_name: '' }));
              }}
              disabled={staffSaving}
              error={editStaffErrors.first_name}
            />
            <Input
              label="Last Name"
              required={editStaffForm.role === 'CUSTOMER'}
              value={editStaffForm.last_name}
              onChange={e => {
                setEditStaffForm(current => ({ ...current, last_name: e.target.value }));
                setEditStaffErrors(current => ({ ...current, last_name: '' }));
              }}
              disabled={staffSaving}
              error={editStaffErrors.last_name}
            />
          </div>
          <Input
            label="Phone Number"
            type="tel"
            required={editStaffForm.role === 'CUSTOMER'}
            value={editStaffForm.phone_number}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, phone_number: e.target.value }));
              setEditStaffErrors(current => ({ ...current, phone_number: '' }));
            }}
            disabled={staffSaving}
            error={editStaffErrors.phone_number}
          />
          <Textarea
            label="Address"
            required={editStaffForm.role === 'CUSTOMER'}
            rows={3}
            value={editStaffForm.address}
            onChange={e => {
              setEditStaffForm(current => ({ ...current, address: e.target.value }));
              setEditStaffErrors(current => ({ ...current, address: '' }));
            }}
            disabled={staffSaving}
            error={editStaffErrors.address}
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
            Opening cash and cash movement update the closing cash automatically. The system saves the report first, then sends it to the selected 58mm cashier printer.
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
            Cash sales: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayCashSales || 0)}. Approved booking income: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayBookingIncome || 0)}. GCash sales: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayGcashSales || 0)}. Gross sales: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayGrossSales || 0)}. Expected cash: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(displayedEndOfDayExpectedCash || 0)}.
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

      <EndOfDayReportDetailsModal
        report={selectedEndOfDayReport}
        onClose={closeSavedEndOfDayReport}
        isLoading={endOfDayDetailLoading}
        error={endOfDayDetailError}
      />

      <IngredientStatusModal
        open={ingredientStatusOpen}
        onClose={() => setIngredientStatusOpen(false)}
        statusKey={selectedInventoryStatus.key}
        statusLabel={selectedInventoryStatus.label}
      />
    </div>
  );
}

