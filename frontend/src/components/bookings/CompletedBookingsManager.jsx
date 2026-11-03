import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Camera, CheckCircle, ChevronLeft, ChevronRight, ImagePlus, Link2, Upload } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { LoadingSpinner, Skeleton } from '../ui/Skeleton';

const PAGE_SIZE = 50;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_IMAGES = 20;

const methodOptions = [
  { value: 'IMAGE', label: 'Photos', icon: Camera },
  { value: 'ZIP', label: 'ZIP file', icon: Archive },
  { value: 'GOOGLE_DRIVE', label: 'Drive link', icon: Link2 },
];

const formatSession = booking => `${booking.scheduled_date || 'Date not set'}${booking.scheduled_time ? ` · ${String(booking.scheduled_time).slice(0, 5)}` : ''}`;

export default function CompletedBookingsManager() {
  const [bookings, setBookings] = useState([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedBookingId, setExpandedBookingId] = useState(null);
  const [attachmentType, setAttachmentType] = useState('IMAGE');
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState([]);
  const [driveUrl, setDriveUrl] = useState('');
  const [uploadingBookingId, setUploadingBookingId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  const loadBookings = useCallback(async (nextOffset = 0) => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await client.get('/api/gallery/completed-bookings/', {
        params: { limit: PAGE_SIZE, offset: nextOffset },
      });
      setBookings(Array.isArray(response.data?.results) ? response.data.results : []);
      setCount(Number(response.data?.count) || 0);
      setOffset(nextOffset);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Couldn’t load completed bookings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBookings(0); }, [loadBookings]);

  const openAttachmentForm = bookingId => {
    setExpandedBookingId(current => current === bookingId ? null : bookingId);
    setAttachmentType('IMAGE');
    setTitle('');
    setFiles([]);
    setDriveUrl('');
    setUploadError('');
    setUploadSuccess('');
  };

  const selectFiles = selected => {
    const chosen = Array.from(selected || []);
    setUploadError('');
    setUploadSuccess('');
    if (attachmentType === 'IMAGE') {
      if (chosen.length > MAX_IMAGES) {
        setFiles([]);
        setUploadError(`Choose up to ${MAX_IMAGES} images at a time.`);
        return;
      }
      if (chosen.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_SIZE)) {
        setFiles([]);
        setUploadError('Choose valid JPG, PNG, or WEBP images no larger than 5 MB each.');
        return;
      }
      if (chosen.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_SIZE) {
        setFiles([]);
        setUploadError('The combined image upload must be 50 MB or smaller.');
        return;
      }
    } else if (attachmentType === 'ZIP') {
      if (chosen.length !== 1 || !chosen[0].name.toLowerCase().endsWith('.zip') || chosen[0].size > MAX_TOTAL_SIZE) {
        setFiles([]);
        setUploadError('Choose one ZIP file no larger than 50 MB.');
        return;
      }
    }
    setFiles(chosen);
  };

  const submitAttachment = async booking => {
    if (uploadingBookingId != null) return;
    setUploadError('');
    setUploadSuccess('');
    if (attachmentType === 'GOOGLE_DRIVE') {
      if (!driveUrl.trim()) {
        setUploadError('Enter a Google Drive or Docs sharing link.');
        return;
      }
    } else if (!files.length) {
      setUploadError(attachmentType === 'ZIP' ? 'Choose a ZIP file to upload.' : 'Choose at least one photo to upload.');
      return;
    }

    const formData = new FormData();
    formData.append('booking', String(booking.id));
    formData.append('attachment_type', attachmentType);
    formData.append('title', title.trim());
    if (attachmentType === 'GOOGLE_DRIVE') {
      formData.append('drive_url', driveUrl.trim());
    } else if (attachmentType === 'ZIP') {
      formData.append('archive', files[0]);
    } else {
      files.forEach(file => formData.append('images', file));
    }

    setUploadingBookingId(booking.id);
    setUploadProgress(0);
    try {
      const response = await client.post('/api/gallery/customer-photos/', formData, {
        onUploadProgress: event => {
          if (event.total) setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      });
      const added = Array.isArray(response.data?.results) ? response.data.results : response.data?.id ? [response.data] : [];
      setBookings(current => current.map(item => item.id === booking.id
        ? { ...item, photo_attachments: [...(item.photo_attachments || []), ...added] }
        : item));
      setFiles([]);
      setDriveUrl('');
      setTitle('');
      setUploadProgress(100);
      setUploadSuccess(added.length === 1 ? 'Attachment delivered to the customer.' : `${added.length} photos delivered to the customer.`);
    } catch (error) {
      setUploadError(getApiErrorMessage(error, 'Couldn’t upload the photo. Try again.'));
    } finally {
      setUploadingBookingId(null);
    }
  };

  const previousPage = () => { if (offset > 0) void loadBookings(Math.max(0, offset - PAGE_SIZE)); };
  const nextPage = () => { if (offset + PAGE_SIZE < count) void loadBookings(offset + PAGE_SIZE); };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading-page text-espresso">Completed Bookings</h1>
          <p className="mt-1 text-xs text-espresso/55">Deliver finished session photos to the customer’s private My Photos page.</p>
        </div>
        <span className="rounded-full border border-espresso/10 bg-white px-3 py-1.5 text-xs font-black text-espresso/60">{count} completed sessions</span>
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError}</div>}
      {loading ? (
        <div className="space-y-3" aria-label="Loading completed bookings">
          {[0, 1, 2].map(row => <Skeleton key={row} className="h-36 w-full rounded-2xl" />)}
        </div>
      ) : bookings.length ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
            {bookings.map(booking => {
              const attachments = Array.isArray(booking.photo_attachments) ? booking.photo_attachments : [];
              const customerName = booking.customer_name || booking.customer?.username || 'Customer account unavailable';
              const customerEmail = booking.customer_email || booking.customer?.email || '';
              const customerAccountExists = Boolean(booking.customer_account_id || booking.customer_id || booking.customer?.id);
              const uploading = uploadingBookingId === booking.id;
              const editing = expandedBookingId === booking.id;
              return (
                <Card key={booking.id} className="!p-4 sm:!p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-green-700"><CheckCircle className="mr-1 inline h-3.5 w-3.5" />Completed</span>
                        <span className="text-xs font-bold text-espresso/45">Booking #{booking.id}</span>
                      </div>
                      <h2 className="mt-2 text-base font-black text-espresso">{booking.package_details?.name || `Package #${booking.package}`}</h2>
                      <div className="mt-2 grid gap-1 text-xs text-espresso/60 sm:grid-cols-2">
                        <p><span className="font-bold text-espresso/75">Customer:</span> {customerName}</p>
                        <p><span className="font-bold text-espresso/75">Session:</span> {formatSession(booking)}</p>
                        {customerEmail && <p className="break-all"><span className="font-bold text-espresso/75">Email:</span> {customerEmail}</p>}
                      </div>
                      {attachments.length > 0 && (
                        <div className="mt-4 space-y-2 border-t border-espresso/[0.07] pt-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-espresso/45">Delivered attachments · {attachments.length}</p>
                          <div className="flex flex-wrap gap-2">
                            {attachments.map(attachment => (
                              <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[10px] font-bold text-espresso/65">
                                {attachment.attachment_type === 'ZIP' ? <Archive className="h-3.5 w-3.5" /> : attachment.attachment_type === 'GOOGLE_DRIVE' ? <Link2 className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                                <span className="truncate">{attachment.title || attachment.file_name || attachment.attachment_type}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant={editing ? 'outline' : 'gold'} icon={ImagePlus} disabled={!customerAccountExists || uploadingBookingId != null} onClick={() => openAttachmentForm(booking.id)}>
                      {editing ? 'Close' : attachments.length ? 'Add Photos' : 'Attach Photos'}
                    </Button>
                  </div>
                  {!customerAccountExists && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This session isn’t linked to a customer account, so it won’t appear in My Photos.</p>}

                  {editing && customerAccountExists && (
                    <div className="mt-4 space-y-4 border-t border-espresso/[0.08] pt-4">
                      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-espresso/10 bg-cream/60 p-1" role="group" aria-label={`Attachment type for booking ${booking.id}`}>
                        {methodOptions.map(option => {
                          const Icon = option.icon;
                          const selected = attachmentType === option.value;
                          return <button key={option.value} type="button" disabled={uploading} aria-pressed={selected} onClick={() => { setAttachmentType(option.value); setFiles([]); setUploadError(''); }} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition ${selected ? 'bg-espresso text-gold shadow-sm' : 'text-espresso/60 hover:bg-white hover:text-espresso'}`}><Icon className="h-3.5 w-3.5" />{option.label}</button>;
                        })}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5 text-[10px] font-black uppercase tracking-wider text-espresso/55">
                          Attachment title <span className="font-medium normal-case tracking-normal">(optional)</span>
                          <input value={title} maxLength={160} disabled={uploading} onChange={event => setTitle(event.target.value)} placeholder="Finished studio portraits" className="w-full rounded-xl border border-espresso/10 bg-white px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-espresso outline-none focus:border-gold focus:ring-4 focus:ring-gold/15" />
                        </label>
                        {attachmentType === 'GOOGLE_DRIVE' ? (
                          <label className="space-y-1.5 text-[10px] font-black uppercase tracking-wider text-espresso/55">
                            Google Drive sharing link
                            <input type="url" value={driveUrl} disabled={uploading} onChange={event => setDriveUrl(event.target.value)} placeholder="https://drive.google.com/file/d/…" className="w-full rounded-xl border border-espresso/10 bg-white px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-espresso outline-none focus:border-gold focus:ring-4 focus:ring-gold/15" />
                            <span className="block font-medium normal-case tracking-normal">Set access to “Anyone with the link” so the customer can view it.</span>
                          </label>
                        ) : (
                          <label className="space-y-1.5 text-[10px] font-black uppercase tracking-wider text-espresso/55">
                            {attachmentType === 'ZIP' ? 'ZIP photo archive' : 'Session photos'}
                            <input type="file" disabled={uploading} accept={attachmentType === 'ZIP' ? '.zip,application/zip' : 'image/jpeg,image/png,image/webp'} multiple={attachmentType === 'IMAGE'} onChange={event => selectFiles(event.target.files)} className="block w-full rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-espresso file:mr-3 file:rounded-lg file:border-0 file:bg-cream file:px-3 file:py-2 file:text-xs file:font-bold file:text-espresso" />
                            <span className="block font-medium normal-case tracking-normal">{attachmentType === 'ZIP' ? 'One ZIP, up to 50 MB. It must contain JPG, PNG, or WEBP photos.' : 'Up to 20 JPG, PNG, or WEBP images; 5 MB each and 50 MB total.'}</span>
                          </label>
                        )}
                      </div>
                      {files.length > 0 && <p className="text-xs font-semibold text-espresso/55">{files.length === 1 ? files[0].name : `${files.length} images selected`}</p>}
                      {uploading && (
                        <div className="space-y-1.5" role="status" aria-label={`Uploading photos ${uploadProgress}%`}>
                          <div className="flex justify-between text-[10px] font-bold text-espresso/55"><span>Uploading securely</span><span>{uploadProgress}%</span></div>
                          <div className="h-2 overflow-hidden rounded-full bg-cream"><div className="h-full rounded-full bg-gold transition-[width] duration-200" style={{ width: `${uploadProgress}%` }} /></div>
                          <div className="flex items-center gap-2 text-[10px] text-espresso/45"><LoadingSpinner size="sm" />Keep this page open while files upload.</div>
                        </div>
                      )}
                      {uploadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{uploadError}</p>}
                      {uploadSuccess && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">{uploadSuccess}</p>}
                      <div className="flex justify-end">
                        <Button size="sm" icon={Upload} loading={uploading} disabled={uploading || uploadingBookingId != null} onClick={() => submitAttachment(booking)}>
                          {attachmentType === 'GOOGLE_DRIVE' ? 'Share with Customer' : 'Upload & Deliver'}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-espresso/[0.08] bg-white px-3 py-2">
            <p className="text-xs font-medium text-espresso/55">Showing {count ? offset + 1 : 0}–{Math.min(offset + bookings.length, count)} of {count}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" icon={ChevronLeft} disabled={loading || offset === 0} onClick={previousPage}>Previous</Button>
              <Button size="sm" variant="outline" icon={ChevronRight} disabled={loading || offset + PAGE_SIZE >= count} onClick={nextPage}>Next</Button>
            </div>
          </div>
        </>
      ) : loadError ? null : (
        <EmptyState icon={Camera} title="No completed bookings yet" description="Completed sessions will appear here so you can deliver their photos." />
      )}
    </div>
  );
}
