import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Check, Clock, UserPlus } from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { getManilaDateInputValue } from '../utils/dateTime';

const idempotencyKey = () => `walk-in-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`.slice(0, 100);
const peso = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalkInBookingModal({ open, onClose, onCreated }) {
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [date, setDate] = useState(getManilaDateInputValue());
  const [slots, setSlots] = useState([]);
  const [time, setTime] = useState('');
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', paymentAmount: '', paymentMethod: 'CASH', paymentReference: '' });
  const inFlight = useRef(false);

  const selectedService = services.find(service => String(service.id) === String(serviceId));
  const packages = useMemo(() => selectedService?.packages || [], [selectedService]);
  const selectedPackage = packages.find(item => String(item.id) === String(packageId));

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingServices(true);
    client.get('/api/bookings/services/')
      .then(({ data }) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : data?.results || [];
        setServices(list);
        if (list.length) setServiceId(String(list[0].id));
      })
      .catch(err => active && setError(getApiErrorMessage(err, 'Could not load booking services.')))
      .finally(() => active && setLoadingServices(false));
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !packageId || !date) { setSlots([]); setTime(''); return; }
    let active = true;
    setLoadingSlots(true);
    setError('');
    client.get('/api/bookings/availability/', { params: { package: packageId, date } })
      .then(({ data }) => {
        if (!active) return;
        const available = (data?.slots || []).filter(slot => slot.available);
        setSlots(available);
        setTime(current => available.some(slot => slot.time === current) ? current : '');
        if (!available.length) setNotice(data?.notice || 'No available times for this date. Choose another date.');
        else setNotice('');
      })
      .catch(err => active && setError(getApiErrorMessage(err, 'Could not check availability.')))
      .finally(() => active && setLoadingSlots(false));
    return () => { active = false; };
  }, [open, packageId, date]);

  const setField = key => event => setForm(previous => ({ ...previous, [key]: event.target.value }));
  const chooseService = event => { setServiceId(event.target.value); setPackageId(''); setTime(''); };

  const submit = async event => {
    event.preventDefault();
    if (inFlight.current || saving) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    const payload = {
      package: Number(packageId), scheduled_date: date, scheduled_time: time,
      customer_name: form.name.trim(), customer_email: form.email.trim(), customer_phone: form.phone.trim(),
      notes: form.notes.trim(), idempotency_key: idempotencyKey(),
    };
    if (form.paymentAmount !== '') {
      payload.payment_method = form.paymentMethod;
      payload.payment_amount = form.paymentAmount;
      if (form.paymentMethod !== 'CASH') payload.payment_reference = form.paymentReference.trim();
    }
    try {
      const { data } = await client.post('/api/bookings/walk-in/', payload);
      setNotice(`Walk-in booking #${data.id} confirmed in the schedule.`);
      onCreated?.(data);
      window.setTimeout(() => onClose?.(), 700);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save this walk-in booking. Check availability and try again.'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const resetClose = () => {
    if (saving) return;
    setError(''); setNotice(''); setPackageId(''); setTime(''); setForm({ name: '', email: '', phone: '', notes: '', paymentAmount: '', paymentMethod: 'CASH', paymentReference: '' });
    onClose?.();
  };

  return (
    <Modal open={open} onClose={resetClose} title="Create Walk-in Booking" size="2xl" bodyClassName="max-h-[calc(100vh-12rem)]">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-gold/20 bg-gold/10 p-3 text-sm text-espresso">
          <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-gold-dark" />
          <p>This reservation is saved with the shared booking schedule and labeled <strong>Walk-in</strong>. No customer account is created.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Service" value={serviceId} onChange={chooseService} disabled={loadingServices} options={services.map(item => ({ value: String(item.id), label: item.name }))} />
          <Select label="Package" value={packageId} onChange={event => { setPackageId(event.target.value); setTime(''); }} disabled={!packages.length} options={[{ value: '', label: 'Choose a package' }, ...packages.map(item => ({ value: String(item.id), label: item.name }))]} />
        </div>
        {selectedPackage && <div className="rounded-xl bg-cream/70 px-4 py-3 text-sm"><div className="font-bold text-espresso">{selectedService?.name} · {selectedPackage.name}</div><div className="mt-1 font-extrabold text-gold-dark">{peso(selectedPackage.price)}</div><p className="mt-1 text-xs text-espresso/60">{selectedPackage.inclusions}</p></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Booking date" type="date" icon={Calendar} min={getManilaDateInputValue()} value={date} onChange={event => { setDate(event.target.value); setTime(''); }} required />
          <Select label="Available time" icon={Clock} value={time} onChange={event => setTime(event.target.value)} disabled={!packageId || loadingSlots} options={[{ value: '', label: loadingSlots ? 'Checking availability…' : 'Choose an available time' }, ...slots.map(slot => ({ value: slot.time, label: slot.display_time || slot.label }))]} />
        </div>
        {notice && <p role="status" className="text-xs font-semibold text-amber-800">{notice}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Customer name" value={form.name} onChange={setField('name')} autoComplete="name" required maxLength={200} />
          <Input label="Contact number" type="tel" value={form.phone} onChange={setField('phone')} autoComplete="tel" required maxLength={30} />
          <Input label="Email (optional)" type="email" value={form.email} onChange={setField('email')} autoComplete="email" maxLength={254} />
          <Input label="Payment amount (optional)" type="number" min="0.01" max={selectedPackage?.price || undefined} step="0.01" value={form.paymentAmount} onChange={setField('paymentAmount')} placeholder="Leave blank if unpaid" />
        </div>
        {form.paymentAmount !== '' && <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Payment method" value={form.paymentMethod} onChange={setField('paymentMethod')} options={[{ value: 'CASH', label: 'Cash (recorded as paid)' }, { value: 'GCASH', label: 'GCash (pending verification)' }, { value: 'MAYA', label: 'Maya (pending verification)' }, { value: 'MARIBANK', label: 'MariBank (pending verification)' }]} />
          {form.paymentMethod !== 'CASH' && <Input label="Payment reference" value={form.paymentReference} onChange={setField('paymentReference')} required minLength={6} maxLength={100} />}
          <p className="sm:col-span-2 text-xs text-espresso/55">Recorded deposits must be at least 50% of the package price ({selectedPackage ? peso(Number(selectedPackage.price) * 0.5) : '—'}).</p>
        </div>}
        <Textarea label="Notes (optional)" value={form.notes} onChange={setField('notes')} rows={2} maxLength={2000} />
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-espresso/10 pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={resetClose} disabled={saving}>Cancel</Button>
          <Button type="submit" icon={Check} loading={saving} disabled={!selectedPackage || !date || !time || loadingSlots || !form.name.trim() || !form.phone.trim()}>{saving ? 'Saving booking…' : 'Confirm Walk-in Booking'}</Button>
        </div>
      </form>
    </Modal>
  );
}
