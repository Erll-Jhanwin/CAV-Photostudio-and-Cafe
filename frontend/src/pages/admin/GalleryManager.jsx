import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Edit, ImagePlus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input, Select, Textarea } from '../../components/ui/Input';

const EMPTY_FORM = {
  title: '',
  category: 'STUDIO',
  alt_text: '',
  caption: '',
  sort_order: '0',
  is_featured: true,
};

const CATEGORY_OPTIONS = [
  { value: 'STUDIO', label: 'Studio' },
  { value: 'CAFE', label: 'Café' },
  { value: 'EVENTS', label: 'Events' },
  { value: 'BEHIND_THE_SCENES', label: 'Behind the Scenes' },
];

const FILTER_OPTIONS = [
  { value: 'ALL', label: 'All images' },
  ...CATEGORY_OPTIONS,
];

const getCategory = image => image.category || 'STUDIO';

export default function GalleryManager() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [previewIndex, setPreviewIndex] = useState(null);
  const [brokenImageIds, setBrokenImageIds] = useState(() => new Set());
  const revealRootRef = useRef(null);
  const closePreviewRef = useRef(null);
  const previewTriggerRef = useRef(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await client.get('/api/gallery/images/', {
        params: { include_unfeatured: 'true' },
      });
      setImages(Array.isArray(response.data) ? response.data : []);
      setBrokenImageIds(new Set());
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load gallery images.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadImages(); }, [loadImages]);

  const filteredImages = useMemo(() => (
    activeFilter === 'ALL' ? images : images.filter(image => getCategory(image) === activeFilter)
  ), [activeFilter, images]);
  const publicCount = images.filter(image => image.is_featured).length;
  const hiddenCount = images.length - publicCount;
  const previewImage = previewIndex === null ? null : filteredImages[previewIndex] || null;

  useEffect(() => {
    const root = revealRootRef.current;
    const cards = root?.querySelectorAll('[data-gallery-reveal]') || [];
    if (!cards.length) return undefined;
    if (!('IntersectionObserver' in window)) {
      cards.forEach(card => card.classList.add('gallery-reveal-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('gallery-reveal-visible');
          currentObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -48px 0px', threshold: 0.08 });
    cards.forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [filteredImages, loading]);

  useEffect(() => {
    if (!previewImage) {
      if (previewTriggerRef.current) {
        previewTriggerRef.current.focus();
        previewTriggerRef.current = null;
      }
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closePreviewRef.current?.focus();
    const handleKeyDown = event => {
      if (event.key === 'Escape') setPreviewIndex(null);
      if (event.key === 'ArrowLeft' && filteredImages.length > 1) {
        setPreviewIndex(index => (index === 0 ? filteredImages.length - 1 : index - 1));
      }
      if (event.key === 'ArrowRight' && filteredImages.length > 1) {
        setPreviewIndex(index => (index === filteredImages.length - 1 ? 0 : index + 1));
      }
      if (event.key === 'Tab') {
        const dialog = document.querySelector('.gallery-lightbox[role="dialog"]');
        const buttons = dialog?.querySelectorAll('button:not([disabled])') || [];
        if (!buttons.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filteredImages.length, previewImage]);

  const updateForm = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFile(null);
  };

  const startEdit = image => {
    setEditingId(image.id);
    setForm({
      title: image.title || '',
      category: image.category || 'STUDIO',
      alt_text: image.alt_text || '',
      caption: image.caption || '',
      sort_order: String(image.sort_order ?? 0),
      is_featured: Boolean(image.is_featured),
    });
    setFile(null);
    setError('');
    setNotice('');
    const formElement = document.querySelector('[aria-label="Gallery image form"]');
    if (formElement?.scrollIntoView) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      formElement.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const submit = async event => {
    event.preventDefault();
    if (!editingId && !file) {
      setError('Choose an image file to upload.');
      return;
    }
    const body = new FormData();
    body.append('title', form.title.trim());
    body.append('category', form.category);
    body.append('alt_text', form.alt_text.trim());
    body.append('caption', form.caption.trim());
    body.append('sort_order', String(Math.max(0, Number(form.sort_order) || 0)));
    body.append('is_featured', String(form.is_featured));
    if (file) body.append('image', file);

    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await client.patch(`/api/gallery/images/${editingId}/`, body);
        setNotice('Gallery image updated.');
      } else {
        await client.post('/api/gallery/images/', body);
        setNotice('Gallery image uploaded.');
      }
      resetForm();
      await loadImages();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not save the gallery image.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteImage = async image => {
    if (!window.confirm(`Delete “${image.title}” from the gallery?`)) return;
    setDeletingId(image.id);
    setError('');
    setNotice('');
    try {
      await client.delete(`/api/gallery/images/${image.id}/`);
      if (editingId === image.id) resetForm();
      setNotice('Gallery image deleted.');
      await loadImages();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not delete the gallery image.'));
    } finally {
      setDeletingId(null);
    }
  };

  const openPreview = (index, trigger) => {
    previewTriggerRef.current = trigger;
    setPreviewIndex(index);
  };

  const showPreview = direction => {
    setPreviewIndex(index => {
      if (index === null || filteredImages.length < 2) return index;
      return (index + direction + filteredImages.length) % filteredImages.length;
    });
  };

  const markBroken = imageId => setBrokenImageIds(current => {
    if (current.has(imageId)) return current;
    const next = new Set(current);
    next.add(imageId);
    return next;
  });

  return (
    <section className="gallery-manager space-y-6" aria-labelledby="gallery-manager-title">
      <header className="gallery-manager-hero relative overflow-hidden rounded-[28px] border border-gold/15 bg-gradient-to-br from-white via-cream/85 to-gold/10 p-5 shadow-[0_18px_55px_rgba(46,26,17,0.07)] md:p-7">
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-gold/20 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-gold-dark">
              <Camera className="h-3.5 w-3.5" /> CAV visual stories
            </span>
            <h1 id="gallery-manager-title" className="heading-page text-espresso">Photo Gallery</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-espresso/65 md:text-base">
              Curate the moments guests see first. Preview, organize, and publish your latest studio and café imagery.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Gallery image totals">
            <div className="rounded-2xl border border-espresso/[0.06] bg-white/80 px-3 py-3 text-center sm:min-w-24 sm:px-4">
              <p className="text-xl font-black text-espresso">{images.length}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/50">Total</p>
            </div>
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-3 text-center sm:min-w-24 sm:px-4">
              <p className="text-xl font-black text-emerald-700">{publicCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/65">Public</p>
            </div>
            <div className="rounded-2xl border border-espresso/[0.06] bg-white/80 px-3 py-3 text-center sm:min-w-24 sm:px-4">
              <p className="text-xl font-black text-espresso/70">{hiddenCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/50">Hidden</p>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />
      </header>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(290px,0.78fr)_minmax(0,1.6fr)]">
        <Card className="gallery-form-card !overflow-hidden !p-0 2xl:sticky 2xl:top-5">
          <div className="border-b border-espresso/[0.06] bg-cream/45 px-4 py-4 md:px-5">
            <CardHeader
              title={editingId ? 'Edit Gallery Image' : 'Add to Gallery'}
              subtitle="Upload a validated JPG, PNG, or WEBP image (maximum 5 MB)."
            />
          </div>
          <form onSubmit={submit} className="space-y-4 p-4 md:p-5" aria-label="Gallery image form">
            <Input label="Title" required maxLength={160} value={form.title} onChange={event => updateForm('title', event.target.value)} disabled={saving} />
            <Select label="Category" options={CATEGORY_OPTIONS} value={form.category} onChange={event => updateForm('category', event.target.value)} disabled={saving} />
            <Input
              label={editingId ? 'Replace image (optional)' : 'Image file'}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              required={!editingId}
              onChange={event => setFile(event.target.files?.[0] || null)}
              disabled={saving}
            />
            <Input label="Alternative text" maxLength={220} value={form.alt_text} onChange={event => updateForm('alt_text', event.target.value)} disabled={saving} />
            <Textarea label="Caption" rows={3} value={form.caption} onChange={event => updateForm('caption', event.target.value)} disabled={saving} />
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-1 min-[1600px]:grid-cols-2 sm:items-end">
              <Input label="Sort order" type="number" min="0" step="1" value={form.sort_order} onChange={event => updateForm('sort_order', event.target.value)} disabled={saving} />
              <label className="flex min-h-12 items-center gap-3 rounded-xl border border-espresso/[0.07] bg-cream/45 px-3 text-sm font-semibold text-espresso">
                <input type="checkbox" checked={form.is_featured} onChange={event => updateForm('is_featured', event.target.checked)} disabled={saving} />
                Show on public gallery
              </label>
            </div>
            {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
            <div className="flex flex-wrap gap-2 border-t border-espresso/[0.06] pt-4">
              <Button type="submit" variant="gold" icon={editingId ? Save : ImagePlus} loading={saving} disabled={saving || !form.title.trim()}>
                {editingId ? 'Save Changes' : 'Upload Image'}
              </Button>
              {editingId && <Button type="button" variant="outline" icon={X} onClick={resetForm} disabled={saving}>Cancel edit</Button>}
            </div>
          </form>
        </Card>

        <Card className="gallery-collection-card !p-4 md:!p-5 xl:!p-6">
          <div className="flex flex-col gap-4 border-b border-espresso/[0.06] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <CardHeader title="Managed Gallery" subtitle="Select an image to preview it. Changes here update the gallery catalog." />
            <Button type="button" variant="outline" size="sm" icon={RefreshCw} onClick={loadImages} loading={loading} disabled={loading}>
              Refresh
            </Button>
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-4 scrollbar-thin" aria-label="Filter gallery by category">
            {FILTER_OPTIONS.map(option => {
              const count = option.value === 'ALL' ? images.length : images.filter(image => getCategory(image) === option.value).length;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setActiveFilter(option.value)}
                  aria-pressed={activeFilter === option.value}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${activeFilter === option.value ? 'border-espresso bg-espresso text-white shadow-md' : 'border-espresso/10 bg-white text-espresso/70 hover:border-gold/45 hover:bg-cream/60 hover:text-espresso'}`}
                >
                  {option.label}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeFilter === option.value ? 'bg-white/15 text-white' : 'bg-cream text-espresso/55'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1400px]:grid-cols-3" aria-label="Loading gallery images">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="aspect-[4/3] animate-pulse rounded-2xl bg-cream" />)}
            </div>
          ) : filteredImages.length ? (
            <div ref={revealRootRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1400px]:grid-cols-3">
              {filteredImages.map((image, index) => {
                const broken = brokenImageIds.has(image.id);
                const hasImage = image.image_url && !broken;
                return (
                  <article key={image.id} data-gallery-reveal className="gallery-reveal group overflow-hidden rounded-[22px] border border-espresso/[0.08] bg-white shadow-[0_8px_26px_rgba(46,26,17,0.06)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-gold/30 hover:shadow-[0_18px_42px_rgba(46,26,17,0.13)]">
                    <div className="gallery-image-frame relative aspect-[4/3] overflow-hidden bg-cream">
                      {hasImage ? (
                        <>
                          <img
                            src={image.image_url}
                            alt={image.alt_text || image.title}
                            loading={index < 2 ? 'eager' : 'lazy'}
                            fetchPriority={index === 0 ? 'high' : 'auto'}
                            decoding="async"
                            onError={() => markBroken(image.id)}
                            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045]"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-espresso/65 via-transparent to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-95" />
                          <button
                            type="button"
                            onClick={event => openPreview(index, event.currentTarget)}
                            className="absolute inset-0 flex items-center justify-center text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-gold"
                            aria-label={`Preview ${image.title}`}
                          >
                            <span className="translate-y-2 rounded-full border border-white/35 bg-espresso/55 px-4 py-2 text-xs font-bold opacity-0 shadow-lg backdrop-blur transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                              Preview image
                            </span>
                          </button>
                        </>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-xs text-espresso/60">
                          <Camera className="h-7 w-7 text-espresso/30" />
                          {image.image_url ? 'This image could not be loaded. Upload a replacement to restore it.' : 'Archived gallery record. Upload a replacement image before publishing.'}
                        </div>
                      )}
                      <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold shadow-sm backdrop-blur ${image.is_featured ? 'bg-emerald-50/95 text-emerald-800' : 'bg-white/90 text-espresso/65'}`}>
                        {image.is_featured && <Check className="h-3 w-3" />}{image.is_featured ? 'Public' : 'Hidden'}
                      </span>
                      <span className="absolute bottom-3 right-3 rounded-full border border-white/25 bg-espresso/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                        {image.category_label || image.category}
                      </span>
                    </div>
                    <div className="space-y-3 p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate font-extrabold text-espresso" title={image.title}>{image.title}</h3>
                          <p className="mt-0.5 text-[11px] font-semibold text-espresso/50">Display order {image.sort_order ?? 0}</p>
                        </div>
                        <span className="sr-only">{image.is_featured ? 'Visible on public gallery' : 'Hidden from public gallery'}</span>
                      </div>
                      {image.caption && <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-espresso/65">{image.caption}</p>}
                      <div className="flex gap-2 border-t border-espresso/[0.06] pt-3">
                        <Button type="button" variant="outline" size="xs" icon={Edit} onClick={() => startEdit(image)} aria-label={`Edit ${image.title}`}>Edit</Button>
                        <Button type="button" variant="ghost" size="xs" icon={Trash2} className="text-red-600" onClick={() => deleteImage(image)} loading={deletingId === image.id} disabled={deletingId !== null} aria-label={`Delete ${image.title}`}>Delete</Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : error ? (
            <EmptyState icon={Camera} title="Gallery unavailable" description={error} />
          ) : images.length ? (
            <div className="rounded-2xl border border-dashed border-espresso/15 bg-cream/35 px-5 py-12 text-center">
              <Camera className="mx-auto h-8 w-8 text-gold-dark/70" />
              <h3 className="mt-3 font-bold text-espresso">No images in this category</h3>
              <button type="button" className="mt-2 text-sm font-bold text-gold-dark underline-offset-4 hover:underline" onClick={() => setActiveFilter('ALL')}>Show all images</button>
            </div>
          ) : (
            <EmptyState icon={Camera} title="No managed images yet" description="Upload your first image to begin building the gallery." />
          )}
        </Card>
      </div>

      {previewImage && (
        <div
          className="gallery-lightbox fixed inset-0 z-[100] flex items-center justify-center bg-espresso-dark/95 p-3 backdrop-blur-md sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${previewImage.title}`}
          onClick={event => { if (event.target === event.currentTarget) setPreviewIndex(null); }}
        >
          <button ref={closePreviewRef} type="button" onClick={() => setPreviewIndex(null)} className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" aria-label="Close image preview">
            <X className="h-5 w-5" />
          </button>
          {filteredImages.length > 1 && (
            <>
              <button type="button" onClick={() => showPreview(-1)} className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-5 sm:h-12 sm:w-12" aria-label="Previous image">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => showPreview(1)} className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-5 sm:h-12 sm:w-12" aria-label="Next image">
                <ArrowRight className="h-5 w-5" />
              </button>
            </>
          )}
          <figure className="gallery-lightbox-content flex max-h-[90vh] w-full max-w-6xl flex-col items-center justify-center gap-4">
            <img src={previewImage.image_url} alt={previewImage.alt_text || previewImage.title} decoding="async" className="max-h-[72vh] max-w-full rounded-2xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:rounded-[24px]" />
            <figcaption className="max-w-2xl px-12 text-center text-white">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-gold">{previewImage.category_label || previewImage.category}</p>
              <h2 className="mt-1 text-lg font-extrabold sm:text-xl">{previewImage.title}</h2>
              {previewImage.caption && <p className="mt-1 text-sm leading-relaxed text-white/70">{previewImage.caption}</p>}
              <p className="mt-2 text-[10px] font-semibold text-white/45">{previewIndex + 1} / {filteredImages.length}</p>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
