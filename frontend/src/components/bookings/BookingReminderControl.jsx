import React, { useState } from 'react';
import { BellRing } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { getManilaDateInputValue } from '../../utils/dateTime';

const CONFIRMED_STATUSES = new Set(['CONFIRMED', 'CONFIRMED_DP']);
const isPhotoSessionBooking = booking => {
  const typeText = `${booking?.package_details?.service?.name || booking?.package_details?.service_name || ''} ${booking?.package_details?.name || ''}`.toLowerCase();
  return typeText.includes('studio') || typeText.includes('photo service') || typeText.includes('event') || typeText.includes('extended photoshoot');
};

export default function BookingReminderControl({ booking }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [alreadySent, setAlreadySent] = useState(false);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState('');
  const [sessionTime, setSessionTime] = useState(String(booking.scheduled_time || '').slice(0, 5));
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!booking?.customer || !CONFIRMED_STATUSES.has(booking.status)
    || booking.scheduled_date !== getManilaDateInputValue() || !isPhotoSessionBooking(booking)) return null;

  const openReminder = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await client.get(`/api/bookings/${booking.id}/reminder/`);
      setMessage(response.data?.default_message || 'We look forward to seeing you for your photo session today.');
      setLocation(response.data?.default_location || '');
      setSessionTime(response.data?.session_time || String(booking.scheduled_time || '').slice(0, 5));
      setAlreadySent(Boolean(response.data?.already_sent));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Reminder preview could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  const sendReminder = async event => {
    event.preventDefault();
    if (sending || alreadySent || !message.trim() || !location.trim()) return;
    setSending(true);
    setError('');
    try {
      const response = await client.post(`/api/bookings/${booking.id}/reminder/`, {
        message: message.trim(),
        location: location.trim(),
      });
      setAlreadySent(true);
      setSuccess(response.data?.created === false ? 'A reminder was already sent for this booking today.' : 'Reminder sent to the customer’s Notifications page.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Reminder could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant={alreadySent ? 'outline' : 'gold'} icon={BellRing} onClick={openReminder} disabled={alreadySent}>
        {alreadySent ? 'Reminder sent' : 'Notify customer'}
      </Button>
      <Modal open={open} onClose={() => !sending && setOpen(false)} title={`Session reminder · Booking #${booking.id}`} size="lg">
        {loading ? (
          <p className="py-8 text-center text-sm font-semibold text-espresso/55" aria-live="polite">Loading reminder preview…</p>
        ) : (
          <form onSubmit={sendReminder} className="space-y-4">
            <p className="text-xs leading-relaxed text-espresso/60">Review the reminder before sending. The session time and location are included automatically in the customer notification.</p>
            <Textarea label="Reminder message" rows={4} maxLength={1200} value={message} onChange={event => setMessage(event.target.value)} required disabled={alreadySent || sending} />
            <Input label="Session location" value={location} onChange={event => setLocation(event.target.value)} maxLength={300} required disabled={alreadySent || sending} placeholder="Studio address or event venue" />
            <div className="rounded-xl border border-espresso/10 bg-cream/55 p-3 text-xs">
              <p className="font-black uppercase tracking-wider text-espresso/45">Customer notification preview</p>
              <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-espresso/75">{message || 'Your reminder message'}{'\n\nSession time: '}{sessionTime}{' (Asia/Manila)\nLocation: '}{location || 'Enter a location'}</p>
            </div>
            {alreadySent && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">A reminder has already been sent for this booking today.</p>}
            {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{success}</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>Close</Button>
              <Button type="submit" variant="gold" icon={BellRing} loading={sending} disabled={alreadySent || !message.trim() || !location.trim()}>
                {alreadySent ? 'Already sent' : 'Send reminder'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
