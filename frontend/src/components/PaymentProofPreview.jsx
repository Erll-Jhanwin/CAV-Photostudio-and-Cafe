import React, { useEffect, useState } from 'react';
import { Eye, FileImage, Minus, Plus, RotateCcw } from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { LoadingSpinner } from './ui/Skeleton';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export default function PaymentProofPreview({ payment }) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [contentType, setContentType] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!open) return undefined;

    setPreviewUrl('');
    setContentType('');
    setError('');
    setMissing(false);
    setZoom(MIN_ZOOM);
    if (!payment?.receipt_url) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    let objectUrl = '';
    setLoading(true);
    client.get(`/api/bookings/payments/${payment.id}/receipt/`, { responseType: 'blob' })
      .then(response => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setPreviewUrl(objectUrl);
        setContentType(
          response.data?.type
          || response.headers?.['content-type']
          || response.headers?.['Content-Type']
          || 'application/octet-stream',
        );
      })
      .catch(requestError => {
        if (!active) return;
        if (requestError?.response?.status === 404) setMissing(true);
        else setError(getApiErrorMessage(requestError, 'Payment proof could not be loaded.'));
      })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, payment?.id, payment?.receipt_url, retryKey]);

  const hasImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  const bookingId = payment?.booking ?? payment?.booking_details?.id ?? '—';

  const retry = () => {
    setError('');
    setPreviewUrl('');
    setRetryKey(value => value + 1);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={Eye}
        onClick={() => setOpen(true)}
        aria-label={`View proof of payment for booking ${bookingId}`}
      >
        View Proof of Payment
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Payment proof · Booking #${bookingId}`}
        size="5xl"
        className="max-h-[calc(100vh-2rem)] overflow-hidden"
        bodyClassName="!max-h-[calc(100vh-8rem)] !overflow-auto !p-4 sm:!p-6"
      >
        {loading ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm font-semibold text-espresso/60" aria-live="polite">
            <LoadingSpinner />
            Loading payment proof…
          </div>
        ) : error ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
            <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>
            <Button type="button" variant="outline" size="sm" icon={RotateCcw} onClick={retry}>
              Try again
            </Button>
          </div>
        ) : missing || !payment?.receipt_url ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-espresso/15 bg-cream/50 p-6 text-center">
            <FileImage className="h-9 w-9 text-espresso/35" aria-hidden="true" />
            <div>
              <p className="font-bold text-espresso">{missing ? 'Payment proof not found' : 'No payment proof attached'}</p>
              <p className="mt-1 text-sm text-espresso/60">{missing ? 'The saved proof file is no longer available in storage.' : 'This payment does not have an uploaded proof file.'}</p>
            </div>
          </div>
        ) : previewUrl && hasImage ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Payment proof image zoom controls">
              <Button type="button" variant="outline" size="sm" icon={Minus} onClick={() => setZoom(value => Math.max(MIN_ZOOM, value - 0.25))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out payment proof" />
              <span className="min-w-14 text-center text-xs font-bold text-espresso/65" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Button type="button" variant="outline" size="sm" icon={Plus} onClick={() => setZoom(value => Math.min(MAX_ZOOM, value + 0.25))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in payment proof" />
              <Button type="button" variant="outline" size="sm" icon={RotateCcw} onClick={() => setZoom(MIN_ZOOM)} disabled={zoom === MIN_ZOOM} aria-label="Reset payment proof zoom" />
            </div>
            <div className="max-h-[65vh] overflow-auto rounded-xl border border-espresso/10 bg-cream/45 p-2 text-center">
              <img
                src={previewUrl}
                alt={`Payment proof for booking ${bookingId}`}
                onError={() => setError('The payment proof image could not be displayed. Try loading it again.')}
                className="mx-auto h-auto max-h-[65vh] object-contain transition-[width] duration-150"
                style={{ width: `${zoom * 100}%` }}
              />
            </div>
          </div>
        ) : previewUrl && isPdf ? (
          <div className="space-y-3">
            <iframe
              src={previewUrl}
              title={`Payment proof PDF for booking ${bookingId}`}
              className="h-[65vh] min-h-80 w-full rounded-xl border border-espresso/10 bg-white"
            />
            <p className="text-center text-xs text-espresso/55">If the document does not display, try downloading it or opening it in a new tab.</p>
          </div>
        ) : previewUrl ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
            <p role="alert" className="text-sm font-semibold text-red-700">This payment proof file type cannot be previewed.</p>
            <Button type="button" variant="outline" size="sm" icon={RotateCcw} onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
