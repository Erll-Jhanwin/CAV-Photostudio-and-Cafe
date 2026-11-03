import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { formatManilaDateTime } from '../../utils/dateTime';
import BookingConversationModal from './BookingConversationModal';

export default function BookingMessagesInbox({ currentUserId }) {
  const [conversations, setConversations] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await client.get('/api/bookings/conversations/inbox/');
      setConversations(Array.isArray(response.data?.results) ? response.data.results : []);
      setUnreadCount(Number(response.data?.unread_count || 0));
      setError('');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Booking messages could not be loaded.'));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gold-dark">Customer support</p>
          <h1 className="mt-1 text-2xl font-black text-espresso">Booking Messages</h1>
          <p className="mt-1 text-sm text-espresso/55">Private customer conversations, organized by booking.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-900" aria-live="polite">{unreadCount} unread</span>
          <Button type="button" size="sm" variant="outline" icon={RefreshCw} onClick={() => refresh(true)}>Refresh</Button>
        </div>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      {loading ? <p className="rounded-2xl bg-white p-8 text-center text-sm font-semibold text-espresso/50">Loading booking conversations…</p> : conversations.length ? (
        <div className="space-y-2" aria-label="Booking conversations">
          {conversations.map(row => (
            <article key={row.booking_id} className="flex flex-col gap-3 rounded-2xl border border-espresso/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-black text-espresso">{row.customer_name}</h2>
                  <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-black uppercase text-espresso/60">{row.concern_label}</span>
                  {row.unread_count > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800">{row.unread_count} unread</span>}
                </div>
                <p className="mt-1 text-xs font-semibold text-espresso/65">Booking #{row.booking_id} · {row.package_name} · {row.scheduled_date} at {row.scheduled_time}</p>
                <p className="mt-1 truncate text-xs text-espresso/50">{row.last_message?.message || 'No messages yet'}</p>
                {row.last_message?.created_at && <time className="mt-1 block text-[10px] text-espresso/40">{formatManilaDateTime(row.last_message.created_at)}</time>}
              </div>
              <Button type="button" variant={row.unread_count ? 'gold' : 'outline'} icon={MessageSquare} className="shrink-0" onClick={() => setSelected(row)}>Open conversation</Button>
            </article>
          ))}
        </div>
      ) : <div className="rounded-2xl border border-dashed border-espresso/15 bg-white p-10 text-center"><MessageSquare className="mx-auto h-8 w-8 text-espresso/30" /><p className="mt-3 font-bold text-espresso/70">No booking conversations yet</p><p className="mt-1 text-xs text-espresso/45">New customer messages and session reminders will appear here.</p></div>}
      <BookingConversationModal
        open={Boolean(selected)}
        bookingId={selected?.booking_id}
        customerName={selected?.customer_name}
        currentUserId={currentUserId}
        onClose={() => { setSelected(null); void refresh(); }}
      />
    </section>
  );
}
