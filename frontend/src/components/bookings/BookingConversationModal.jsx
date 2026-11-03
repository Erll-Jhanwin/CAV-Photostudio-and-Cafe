import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Input';
import { formatManilaDateTime } from '../../utils/dateTime';

export default function BookingConversationModal({ open, bookingId, customerName = 'Customer', currentUserId, allowConcern = false, onClose }) {
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [concern, setConcern] = useState('BOOKING');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const feedRef = useRef(null);

  useEffect(() => {
    if (!open || !bookingId) return undefined;
    let active = true;
    const loadMessages = async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const response = await client.get(`/api/bookings/${bookingId}/conversation/`);
        if (active) {
          const payload = response.data || {};
          setMessages(Array.isArray(payload) ? payload : (Array.isArray(payload.messages) ? payload.messages : []));
          setConversation(Array.isArray(payload) ? null : payload.conversation || null);
          if (!Array.isArray(payload) && payload.conversation?.concern) setConcern(payload.conversation.concern);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(getApiErrorMessage(requestError, 'Couldn’t load this conversation.'));
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };
    setMessages([]);
    setConversation(null);
    setConcern('BOOKING');
    setDraft('');
    void loadMessages(true);
    const timer = window.setInterval(() => { void loadMessages(); }, 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, bookingId]);

  useEffect(() => {
    if (open && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, open]);

  const sendMessage = async event => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await client.post(`/api/bookings/${bookingId}/conversation/`, { message: text, concern });
      setMessages(current => [...current.filter(item => item.id !== response.data.id), response.data]);
      if (allowConcern) setConversation({ concern, concern_label: concern[0] + concern.slice(1).toLowerCase() });
      setDraft('');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Couldn’t send your message.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Booking conversation · #${bookingId || ''}`} size="2xl" bodyClassName="bg-cream/35">
      <div className="space-y-3">
        <p className="text-xs text-espresso/55">Private conversation with {customerName}, linked to booking #{bookingId}.</p>
        {allowConcern ? (
          <label className="block space-y-1.5 text-xs font-bold text-espresso/70">
            <span>What is this about?</span>
            <select aria-label="Message concern" value={concern} onChange={event => setConcern(event.target.value)} disabled={loading || sending} className="h-11 w-full rounded-xl border border-espresso/15 bg-white px-3 text-sm text-espresso focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25 disabled:opacity-60">
              <option value="BOOKING">Booking</option>
              <option value="PAYMENT">Payment</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
        ) : conversation?.concern_label ? (
          <p className="w-fit rounded-full bg-gold/15 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-gold-dark">{conversation.concern_label}</p>
        ) : null}
        <div ref={feedRef} role="log" aria-label="Booking conversation messages" aria-live="polite" className="flex max-h-[50dvh] min-h-48 flex-col gap-2 overflow-y-auto rounded-2xl border border-espresso/10 bg-white p-3 sm:p-4">
          {loading ? (
            <p className="m-auto text-xs font-semibold text-espresso/50">Loading conversation…</p>
          ) : messages.length ? messages.map(message => {
            const ownMessage = Number(message.author_id) === Number(currentUserId);
            return (
              <article key={message.id} className={`max-w-[90%] rounded-2xl px-3 py-2.5 text-xs ${ownMessage ? 'self-end bg-espresso text-white' : 'self-start bg-cream text-espresso'}`}>
                <p className={`mb-1 font-black ${ownMessage ? 'text-gold' : 'text-espresso/65'}`}>{ownMessage ? 'You' : message.author_name || 'Booking participant'}</p>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.message}</p>
                <time className={`mt-1 block text-right text-[9px] ${ownMessage ? 'text-white/55' : 'text-espresso/40'}`}>{formatManilaDateTime(message.created_at)}</time>
              </article>
            );
          }) : !error ? (
            <p className="m-auto text-center text-xs text-espresso/50">No messages yet. Start the booking conversation here.</p>
          ) : null}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        <form onSubmit={sendMessage} className="space-y-2">
          <Textarea label="Message" rows={3} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message about this booking…" disabled={loading || sending} />
          <div className="flex justify-end">
            <Button type="submit" icon={Send} loading={sending} disabled={!draft.trim() || loading}>Send message</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
