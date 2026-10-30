import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, CheckCircle, Camera } from 'lucide-react';
import client from '../api/client';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';

export default function BookingFeedbackPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [booking, setBooking] = useState(null);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This feedback link is incomplete. Please use the link from your CAV email.');
      setLoading(false);
      return;
    }
    client.get('/api/bookings/reviews/survey/', { params: { token } })
      .then(({ data }) => {
        setBooking(data);
        setSubmitted(Boolean(data.already_submitted));
      })
      .catch(err => setError(err.response?.data?.detail || 'This feedback link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async event => {
    event.preventDefault();
    setError('');
    if (rating < 1 || rating > 5) {
      setError('Please choose a satisfaction rating.');
      return;
    }
    setSaving(true);
    try {
      await client.post('/api/bookings/reviews/survey/', { token, rating, feedback: feedback.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.rating || 'We could not save your response. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 text-espresso">
      <section className="w-full max-w-xl rounded-3xl border border-gold/25 bg-white p-6 shadow-[0_24px_70px_rgba(46,26,17,0.12)] sm:p-10">
        <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold-dark"><Camera aria-hidden="true" /></div>
        {loading ? <p role="status" className="text-sm text-espresso/60">Loading your feedback survey…</p> : submitted ? (
          <div className="text-center">
            <CheckCircle className="mx-auto mb-4 h-12 w-12 text-gold-dark" aria-hidden="true" />
            <h1 className="text-2xl font-black">Thank you for your feedback</h1>
            <p className="mt-2 text-sm leading-relaxed text-espresso/65">Your response has been saved for our team to review.</p>
            <Link to="/" className="mt-6 inline-block text-sm font-bold text-gold-dark underline">Return to CAV</Link>
          </div>
        ) : error && !booking ? (
          <div><h1 className="text-2xl font-black">Feedback survey</h1><p role="alert" className="mt-3 text-sm text-red-700">{error}</p><Link to="/" className="mt-6 inline-block text-sm font-bold text-gold-dark underline">Return to CAV</Link></div>
        ) : (
          <>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gold-dark">Your CAV experience</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">How was your session?</h1>
            <p className="mt-2 text-sm text-espresso/65">Booking #{booking?.booking_id} · {booking?.service} · {booking?.package}</p>
            <form onSubmit={submit} className="mt-7 space-y-6">
              <fieldset>
                <legend className="text-sm font-bold">How satisfied were you?</legend>
                <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Satisfaction rating">
                  {[1, 2, 3, 4, 5].map(value => (
                    <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} onClick={() => setRating(value)} className={`rounded-xl p-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${value <= rating ? 'text-gold-dark' : 'text-espresso/25 hover:text-gold'}`}>
                      <Star className={`h-8 w-8 ${value <= rating ? 'fill-current' : ''}`} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </fieldset>
              <Textarea label="Comments (optional)" value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={2000} rows={4} placeholder="Tell us what you enjoyed or what we could improve." />
              {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
              <Button type="submit" variant="gold" loading={saving} disabled={saving}>{saving ? 'Submitting…' : 'Submit feedback'}</Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
