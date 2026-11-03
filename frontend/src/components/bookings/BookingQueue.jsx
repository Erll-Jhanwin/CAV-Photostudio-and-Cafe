import React, { useMemo, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { StatusBadge } from '../ui/Badge';
import { getManilaDateInputValue } from '../../utils/dateTime';
import BookingReminderControl from './BookingReminderControl';

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CONFIRMED_DP']);
const timeKey = booking => `${booking.scheduled_time || ''}`.slice(0, 8);
const scheduleKey = booking => `${booking.scheduled_date || ''} ${timeKey(booking)} ${String(booking.id).padStart(12, '0')}`;
const customerName = booking => booking.customer_name || booking.contact_name || `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim() || booking.customer?.username || 'Customer';
const peso = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paymentSummary = booking => {
  const payments = Array.isArray(booking.payments) ? booking.payments : [];
  return payments.length ? payments.map(payment => String(payment.status || 'Pending').replace(/_/g, ' ')).join(', ') : 'No payment submitted';
};

const groupBookings = (bookings, today) => {
  const sorted = [...bookings].sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b)));
  return {
    live: sorted.filter(row => row.scheduled_date >= today && ACTIVE_STATUSES.has(row.status)),
    pastActive: sorted.filter(row => row.scheduled_date < today && ACTIVE_STATUSES.has(row.status)),
    completed: sorted.filter(row => row.status === 'COMPLETED'),
    cancelled: sorted.filter(row => row.status === 'CANCELLED'),
  };
};

function BookingCard({ booking, busyAction, onComplete, onCancel, onDelete }) {
  const actionInProgress = Boolean(busyAction);
  const itemsTotal = (Array.isArray(booking.items) ? booking.items : []).reduce((total, item) => total + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const totalAmount = Number(booking.total_amount ?? (Number(booking.package_details?.price || 0) + itemsTotal));
  const amountPaid = Number(booking.amount_paid ?? (Array.isArray(booking.payments) ? booking.payments : [])
    .filter(payment => ['APPROVED', 'PAID'].includes(payment.status))
    .reduce((total, payment) => total + Number(payment.amount || 0), 0));
  const remainingBalance = Number(booking.remaining_balance ?? Math.max(totalAmount - amountPaid, 0));
  return (
    <article className="rounded-2xl border border-espresso/10 bg-cream/40 p-4 text-xs sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Booking</p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={booking.status} />
            </div>
            <p className="mt-2 font-black text-espresso">Booking #{booking.id}</p>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Customer</p>
            <p className="break-words font-bold text-espresso/75">{customerName(booking)}</p>
            {(booking.customer_email || booking.contact_email || booking.customer?.email) && <p className="mt-1 break-all text-espresso/55">{booking.customer_email || booking.contact_email || booking.customer?.email}</p>}
            {booking.is_walk_in && <p className="mt-1 text-[10px] font-bold text-gold-dark">Walk-in · {booking.created_by_name || 'Staff'}</p>}
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Schedule</p>
            <p className="font-bold text-espresso/75">{booking.scheduled_date || 'Date not set'}</p>
            <p className="mt-1 font-bold text-espresso/60">{timeKey(booking).slice(0, 5) || 'Time not set'}</p>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Package & payment</p>
            <p className="break-words font-bold text-espresso/75">{booking.package_details?.name || `Package #${booking.package}`}</p>
            <p className="mt-1 font-medium text-espresso/55">Payment: {paymentSummary(booking)}</p>
          </div>
        </div>
        {ACTIVE_STATUSES.has(booking.status) && (
          <div className="flex shrink-0 flex-col gap-2 sm:w-44">
            <BookingReminderControl booking={booking} />
            <Button size="sm" variant="success" icon={Check} loading={busyAction === 'complete'} disabled={actionInProgress} onClick={() => onComplete(booking)}>Photo Shoot Done</Button>
            <Button size="sm" variant="outline" icon={X} disabled={actionInProgress} className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onCancel(booking)}>Cancel Booking</Button>
          </div>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-espresso/[0.06] bg-white/75 p-3">
        <div><dt className="text-[9px] font-black uppercase tracking-wider text-espresso/45">Total Amount</dt><dd className="mt-1 font-black text-espresso">{peso(totalAmount)}</dd></div>
        <div><dt className="text-[9px] font-black uppercase tracking-wider text-espresso/45">Down Payment Paid</dt><dd className="mt-1 font-black text-gold-dark">{peso(amountPaid)}</dd></div>
        <div><dt className="text-[9px] font-black uppercase tracking-wider text-espresso/45">Remaining Balance</dt><dd className="mt-1 font-black text-espresso">{peso(remainingBalance)}</dd></div>
      </dl>
      {onDelete && <button type="button" disabled={actionInProgress} onClick={() => onDelete(booking)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Delete booking ${booking.id}`}><Trash2 className="h-3.5 w-3.5" /> Delete booking</button>}
      {booking.status === 'CANCELLED' && booking.cancellation_reason && (
        <p className="mt-3 border-t border-espresso/10 pt-3 text-espresso/65"><span className="font-black">Cancellation reason:</span> {booking.cancellation_reason}</p>
      )}
    </article>
  );
}

function BookingSection({ title, subtitle, bookings, empty, busyActions, onComplete, onCancel, onDelete }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h3 className="text-sm font-black text-espresso">{title}</h3>{subtitle && <p className="mt-0.5 text-[11px] text-espresso/50">{subtitle}</p>}</div>
        <span className="rounded-full bg-cream px-2.5 py-1 text-[10px] font-black text-espresso/55">{bookings.length}</span>
      </div>
      {bookings.length ? bookings.map(booking => (
        <BookingCard
          key={booking.id}
          booking={booking}
          busyAction={busyActions[booking.id] || null}
          onComplete={onComplete}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      )) : <p className="rounded-xl border border-dashed border-espresso/10 bg-white/70 px-4 py-5 text-center text-xs font-medium text-espresso/45">{empty}</p>}
    </section>
  );
}

export default function BookingQueue({ bookings = [], loading = false, onBookingsChange, onDeleteBooking }) {
  const today = getManilaDateInputValue();
  const groups = useMemo(() => groupBookings(bookings, today), [bookings, today]);
  const [cancelBooking, setCancelBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busyActions, setBusyActions] = useState({});
  const busyActionsRef = useRef(new Map());
  const [actionError, setActionError] = useState('');
  const [activeFilter, setActiveFilter] = useState('live');

  const updateStatus = async (booking, status, cancellation_reason) => {
    const action = status === 'COMPLETED' ? 'complete' : 'cancel';
    if (busyActionsRef.current.has(booking.id)) return;
    busyActionsRef.current.set(booking.id, action);
    setBusyActions(current => ({ ...current, [booking.id]: action }));
    setActionError('');
    try {
      const response = await client.patch(`/api/bookings/${booking.id}/`, {
        status,
        ...(cancellation_reason ? { cancellation_reason } : {}),
      });
      onBookingsChange?.(response.data);
      if (status === 'CANCELLED') {
        setCancelBooking(null);
        setCancelReason('');
      }
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Couldn’t update this booking. Try again.'));
    } finally {
      busyActionsRef.current.delete(booking.id);
      setBusyActions(current => {
        if (current[booking.id] !== action) return current;
        const next = { ...current };
        delete next[booking.id];
        return next;
      });
    }
  };

  const sections = activeFilter === 'completed'
    ? [{ title: 'Completed Session', subtitle: 'Sessions marked completed.', bookings: groups.completed, empty: 'No completed sessions yet.' }]
    : [
      { title: 'Live Booking List', subtitle: 'Upcoming and ongoing sessions.', bookings: groups.live, empty: 'No active bookings are scheduled for today or upcoming days.' },
      { title: 'Past bookings needing an update', subtitle: 'Past sessions remain available until marked done or canceled.', bookings: groups.pastActive, empty: 'No past bookings need an update.' },
      { title: 'Cancelled bookings', subtitle: 'Cancelled records remain available for review or deletion.', bookings: groups.cancelled, empty: 'No cancelled bookings.' },
    ];

  return (
    <div className="space-y-6">
      {actionError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800" role="alert">{actionError}</div>}
      <div className="inline-flex rounded-[20px] border border-espresso/10 bg-white p-1 shadow-sm" role="group" aria-label="Booking list filter">
        {[
          { key: 'live', label: 'Live Booking List' },
          { key: 'completed', label: 'Completed Session' },
        ].map(filter => (
          <button
            key={filter.key}
            type="button"
            aria-pressed={activeFilter === filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`rounded-2xl px-3 py-2 text-xs font-black transition-all ${activeFilter === filter.key ? 'bg-espresso text-gold shadow-sm' : 'text-espresso/60 hover:bg-cream hover:text-espresso'}`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {loading && bookings.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Loading bookings">
          {[0, 1, 2].map(row => <div key={row} className="rounded-2xl border border-espresso/10 bg-cream/40 p-4" aria-hidden="true"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(col => <div key={col} className="space-y-2"><Skeleton className="h-2.5 w-16 rounded-md" /><Skeleton className="h-4 w-32 max-w-full rounded-md" /><Skeleton className="h-3 w-24 rounded-md" /></div>)}</div></div>)}
        </div>
      ) : sections.map(section => <BookingSection key={section.title} {...section} busyActions={busyActions} onComplete={booking => updateStatus(booking, 'COMPLETED')} onCancel={booking => { setCancelBooking(booking); setCancelReason(''); setActionError(''); }} onDelete={onDeleteBooking} />)}
      <Modal open={Boolean(cancelBooking)} onClose={() => { if (!busyActions[cancelBooking?.id]) setCancelBooking(null); }} title="Cancel booking">
        {cancelBooking && <div className="space-y-4">
          <p className="text-sm leading-relaxed text-espresso/70">Cancel booking #{cancelBooking.id} for <span className="font-black text-espresso">{customerName(cancelBooking)}</span>? This will move it to History and record the reason.</p>
          {actionError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800" role="alert">{actionError}</p>}
          <Textarea label="Cancellation reason" rows={3} maxLength={500} required value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Enter why this booking is being canceled" />
          <p className="-mt-2 text-right text-[10px] text-espresso/45">{cancelReason.length}/500</p>
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setCancelBooking(null)} disabled={Boolean(busyActions[cancelBooking.id])}>Keep Booking</Button>
            <Button variant="danger" icon={X} loading={busyActions[cancelBooking.id] === 'cancel'} disabled={!cancelReason.trim() || Boolean(busyActions[cancelBooking.id])} onClick={() => updateStatus(cancelBooking, 'CANCELLED', cancelReason.trim())}>Confirm Cancellation</Button>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
