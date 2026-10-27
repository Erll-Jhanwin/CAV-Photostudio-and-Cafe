import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Edit, ImagePlus, RefreshCw, Save, Trash2, X } from 'lucide-react';
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
  const [brokenImageIds, setBrokenImageIds] = useState(() => new Set());

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

  const startEdit = (image) => {
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
  };

  const submit = async (event) => {
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

  const deleteImage = async (image) => {
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

  return (
    <div className="space-y-4" key="gallery">
      <h1 className="heading-page text-espresso">Photo Gallery</h1>
      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      <Card className="!p-4 md:!p-5">
        <CardHeader
          title={editingId ? 'Edit Gallery Image' : 'Add to Gallery'}
          subtitle="Upload a validated JPG, PNG, or WEBP image (maximum 5 MB)."
        />
        <form onSubmit={submit} className="space-y-4" aria-label="Gallery image form">
          <Input
            label="Title"
            required
            maxLength={160}
            value={form.title}
            onChange={event => updateForm('title', event.target.value)}
            disabled={saving}
          />
          <Select
            label="Category"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={event => updateForm('category', event.target.value)}
            disabled={saving}
          />
          <Input
            label={editingId ? 'Replace image (optional)' : 'Image file'}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            required={!editingId}
            onChange={event => setFile(event.target.files?.[0] || null)}
            disabled={saving}
          />
          <Input
            label="Alternative text"
            maxLength={220}
            value={form.alt_text}
            onChange={event => updateForm('alt_text', event.target.value)}
            disabled={saving}
          />
          <Textarea
            label="Caption"
            rows={3}
            value={form.caption}
            onChange={event => updateForm('caption', event.target.value)}
            disabled={saving}
          />
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <Input
              label="Sort order"
              type="number"
              min="0"
              step="1"
              value={form.sort_order}
              onChange={event => updateForm('sort_order', event.target.value)}
              disabled={saving}
            />
            <label className="flex min-h-12 items-center gap-3 text-sm font-semibold text-espresso">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={event => updateForm('is_featured', event.target.checked)}
                disabled={saving}
              />
              Show on public gallery
            </label>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="gold" icon={editingId ? Save : ImagePlus} loading={saving} disabled={saving || !form.title.trim()}>
              {editingId ? 'Save Changes' : 'Upload Image'}
            </Button>
            {editingId && <Button type="button" variant="outline" icon={X} onClick={resetForm} disabled={saving}>Cancel edit</Button>}
          </div>
        </form>
      </Card>

      <Card className="!p-4 md:!p-5">
        <div className="flex items-start justify-between gap-3">
          <CardHeader title="Managed Gallery" subtitle="Uploaded records stored in the gallery catalog." />
          <Button type="button" variant="outline" size="sm" icon={RefreshCw} onClick={loadImages} loading={loading} disabled={loading}>
            Refresh
          </Button>
        </div>
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-espresso/60">Loading gallery images…</p>
        ) : images.length ? (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {images.map(image => (
              <article key={image.id} className="overflow-hidden rounded-2xl border border-espresso/10 bg-white">
                {image.image_url && !brokenImageIds.has(image.id) ? (
                  <img
                    src={image.image_url}
                    alt={image.alt_text || image.title}
                    loading="lazy"
                    onError={() => setBrokenImageIds(current => {
                      if (current.has(image.id)) return current;
                      const next = new Set(current);
                      next.add(image.id);
                      return next;
                    })}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-cream px-4 text-center text-xs text-espresso/60">
                    {image.image_url
                      ? 'This image could not be loaded. Upload a replacement to restore it.'
                      : 'Archived gallery record. Upload a replacement image before publishing.'}
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-espresso">{image.title}</h3>
                      <p className="text-xs text-espresso/55">{image.category_label} · Order {image.sort_order}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${image.is_featured ? 'bg-emerald-50 text-emerald-700' : 'bg-cream text-espresso/60'}`}>
                      {image.is_featured ? 'Public' : 'Hidden'}
                    </span>
                  </div>
                  {image.caption && <p className="line-clamp-2 text-xs text-espresso/65">{image.caption}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" size="xs" icon={Edit} onClick={() => startEdit(image)} aria-label={`Edit ${image.title}`}>
                      Edit
                    </Button>
                    <Button type="button" variant="ghost" size="xs" icon={Trash2} className="text-red-600" onClick={() => deleteImage(image)} loading={deletingId === image.id} disabled={deletingId !== null} aria-label={`Delete ${image.title}`}>
                      Delete
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={Camera} title="Gallery unavailable" description={error} />
        ) : (
          <EmptyState icon={Camera} title="No managed images yet" description="Uploaded gallery records will appear here." />
        )}
      </Card>
      </div>
    </div>
  );
}
