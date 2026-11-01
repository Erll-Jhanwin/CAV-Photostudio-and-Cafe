import React, { useMemo, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { StatusBadge } from '../ui/Badge';
import { getManilaDateInputValue } from '../../utils/dateTime';

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CONFIRMED_DP']);
const CONFIRMED_STATUSES = new Set(['CONFIRMED', 'CONFIRMED_DP']);
const timeKey = booking => `${booking.scheduled_time || ''}`.slice(0, 8);
const scheduleKey = booking => `${booking.scheduled_date || ''} ${timeKey(booking)} ${String(booking.id).padStart(12, '0')}`;
const customerName = booking => booking.customer_name || booking.contact_name || `${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim() || booking.customer?.username || 'Customer';
const paymentSummary = booking => {
  const payments = Array.isArray(booking.payments) ? booking.payments : [];
  return payments.length ? payments.map(payment => String(payment.status || 'Pending').replace(/_/g, ' ')).join(', ') : 'No payment submitted';
};

const groupBookings = (bookings, today) => {
  const sorted = [...bookings].sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b)));
  const todayConfirmed = sorted.filter(row => row.scheduled_date === today && CONFIRMED_STATUSES.has(row.status));
  return {
    todayConfirmed,
    todayPending: sorted.filter(row => row.scheduled_date === today && row.status === 'PENDING'),
    upcoming: sorted.filter(row => row.scheduled_date > today && ACTIVE_STATUSES.has(row.status)),
    pastActive: sorted.filter(row => row.scheduled_date < today && ACTIVE_STATUSES.has(row.status)),
    history: sorted.filter(row => ['COMPLETED', 'CANCELLED'].includes(row.status)),
  };
};

function BookingCard({ booking, queueNumber, queueLabel, busy, onComplete, onCancel, onDelete }) {
  return (
    <article className="rounded-2xl border border-espresso/10 bg-cream/40 p-4 text-xs sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-espresso/45">Booking</p>
            <div className="flex flex-wrap items-center gap-2">
              {queueNumber != null && <span className="rounded-full bg-gold/20 px-2.5 py-1 text-[10px] font-black text-gold-dark">Queue #{queueNumber}</span>}
              {queueLabel && <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${queueLabel === 'Next' ? 'bg-emerald-100 text-emerald-800' : 'bg-espresso/5 text-espresso/65'}`}>{queueLabel}</span>}
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
            <Button size="sm" variant="success" icon={Check} loading={Boolean(busy)} disabled={Boolean(busy)} onClick={() => onComplete(booking)}>Photo Shoot Done</Button>
            <Button size="sm" variant="outline" icon={X} loading={Boolean(busy)} disabled={Boolean(busy)} className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onCancel(booking)}>Cancel Booking</Button>
          </div>
        )}
      </div>
      {onDelete && <button type="button" onClick={() => onDelete(booking)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50" aria-label={`Delete booking ${booking.id}`}><Trash2 className="h-3.5 w-3.5" /> Delete booking</button>}
      {booking.status === 'CANCELLED' && booking.cancellation_reason && (
        <p className="mt-3 border-t border-espresso/10 pt-3 text-espresso/65"><span className="font-black">Cancellation reason:</span> {booking.cancellation_reason}</p>
      )}
    </article>
  );
}

function BookingSection({ title, subtitle, bookings, empty, queue = false, busyId, onComplete, onCancel, onDelete }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h3 className="text-sm font-black text-espresso">{title}</h3>{subtitle && <p className="mt-0.5 text-[11px] text-espresso/50">{subtitle}</p>}</div>
        <span className="rounded-full bg-cream px-2.5 py-1 text-[10px] font-black text-espresso/55">{bookings.length}</span>
      </div>
      {bookings.length ? bookings.map((booking, index) => (
        <BookingCard
          key={booking.id}
          booking={booking}
          queueNumber={queue ? index + 1 : null}
          queueLabel={queue ? (index === 0 ? 'Next' : 'Waiting') : null}
          busy={busyId === booking.id ? 'busy' : null}
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
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const updateStatus = async (booking, status, cancellation_reason) => {
    if (busyId != null) return;
    setBusyId(booking.id);
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
      setActionError(getApiErrorMessage(error, 'Could not update this booking. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const sections = [
    { title: "Today's confirmed queue", subtitle: 'Scheduled sessions in time order.', bookings: groups.todayConfirmed, empty: 'No confirmed sessions are scheduled for today.', queue: true },
    { title: "Today's bookings awaiting confirmation", bookings: groups.todayPending, empty: 'No bookings are awaiting confirmation today.' },
    { title: 'Upcoming bookings', subtitle: 'Future bookings are listed separately from today’s queue.', bookings: groups.upcoming, empty: 'No upcoming bookings.' },
    { title: 'Past bookings needing an update', subtitle: 'Past sessions remain available until marked done or canceled.', bookings: groups.pastActive, empty: 'No past bookings need an update.' },
    { title: 'History', subtitle: 'Completed and canceled records are retained here.', bookings: groups.history, empty: 'Completed and canceled bookings will appear here.' },
  ];

  return (
    <div className="space-y-6">
      {actionError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800" role="alert">{actionError}</div>}
      {loading && bookings.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Loading bookings">
          {[0, 1, 2].map(row => <div key={row} className="rounded-2xl border border-espresso/10 bg-cream/40 p-4" aria-hidden="true"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(col => <div key={col} className="space-y-2"><Skeleton className="h-2.5 w-16 rounded-md" /><Skeleton className="h-4 w-32 max-w-full rounded-md" /><Skeleton className="h-3 w-24 rounded-md" /></div>)}</div></div>)}
        </div>
      ) : sections.map(section => <BookingSection key={section.title} {...section} busyId={busyId} onComplete={booking => updateStatus(booking, 'COMPLETED')} onCancel={booking => { setCancelBooking(booking); setCancelReason(''); setActionError(''); }} onDelete={onDeleteBooking} />)}
      <Modal open={Boolean(cancelBooking)} onClose={() => { if (busyId == null) setCancelBooking(null); }} title="Cancel booking">
        {cancelBooking && <div className="space-y-4">
          <p className="text-sm leading-relaxed text-espresso/70">Cancel booking #{cancelBooking.id} for <span className="font-black text-espresso">{customerName(cancelBooking)}</span>? This will move it to History and record the reason.</p>
          {actionError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800" role="alert">{actionError}</p>}
          <Textarea label="Cancellation reason" rows={3} maxLength={500} required value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Enter why this booking is being canceled" />
          <p className="-mt-2 text-right text-[10px] text-espresso/45">{cancelReason.length}/500</p>
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setCancelBooking(null)} disabled={busyId != null}>Keep Booking</Button>
            <Button variant="danger" icon={X} loading={busyId === cancelBooking.id} disabled={!cancelReason.trim() || busyId != null} onClick={() => updateStatus(cancelBooking, 'CANCELLED', cancelReason.trim())}>Confirm Cancellation</Button>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
