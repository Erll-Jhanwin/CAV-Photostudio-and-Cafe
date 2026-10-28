import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { LoadingSpinner } from './ui/Skeleton';

export default function PaymentProofPreview({ payment }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [contentType, setContentType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!payment?.receipt_url) { setPreviewUrl(''); return undefined; }
    let active = true;
    let objectUrl = '';
    setLoading(true);
    client.get(`/api/bookings/payments/${payment.id}/receipt/`, { responseType: 'blob' })
      .then(response => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setPreviewUrl(objectUrl);
        setContentType(response.data.type || 'application/octet-stream');
        setError('');
      })
      .catch(err => { if (active) setError(getApiErrorMessage(err, 'Payment proof could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [payment?.id, payment?.receipt_url]);

  if (!payment?.receipt_url) return <p className="mt-1 font-semibold text-amber-700">No payment proof attached</p>;
  if (loading) return <p role="status" className="mt-1 flex items-center gap-1 text-espresso/55"><LoadingSpinner size="sm" /> Loading secure proof…</p>;
  if (error) return <p role="alert" className="mt-1 text-red-700">{error}</p>;
  if (!previewUrl) return null;
  return (
    <div className="mt-2 space-y-2">
      {contentType.startsWith('image/') ? <img src={previewUrl} alt={`Payment proof for booking ${payment.booking}`} className="max-h-56 w-full rounded-lg border border-espresso/10 bg-white object-contain" /> : <p className="rounded-lg border border-espresso/10 bg-white p-3 text-xs text-espresso/65">PDF payment proof attached.</p>}
      <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-gold-dark underline"><ExternalLink className="h-3 w-3" />Open full proof</a>
    </div>
  );
}
