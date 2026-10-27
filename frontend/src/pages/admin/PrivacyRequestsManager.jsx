import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Textarea } from '../../components/ui/Input';

const statusClass = {
  OPEN: 'bg-amber-50 text-amber-800',
  IN_PROGRESS: 'bg-blue-50 text-blue-800',
  COMPLETED: 'bg-emerald-50 text-emerald-800',
  REJECTED: 'bg-red-50 text-red-800',
};

export default function PrivacyRequestsManager() {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await client.get('/api/privacy/requests/admin/');
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load privacy requests.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const updateStatus = async (item, status) => {
    const responseNotes = String(notes[item.id] ?? item.response_notes ?? '').trim();
    if (['COMPLETED', 'REJECTED'].includes(status) && !responseNotes) {
      setError('Add a response note before completing or rejecting a privacy request.');
      return;
    }
    setSavingId(item.id);
    setError('');
    setNotice('');
    try {
      await client.patch(`/api/privacy/requests/admin/${item.id}/`, {
        status,
        response_notes: responseNotes,
      });
      setNotice(`Request #${item.id} updated to ${status.replace('_', ' ').toLowerCase()}.`);
      await loadRequests();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not update the privacy request.'));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4" key="privacy-requests">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-gold-dark">Privacy operations</p>
          <h1 className="heading-page text-espresso">Privacy Requests</h1>
          <p className="mt-1 text-xs text-espresso/60">Review access, correction, deletion, objection and export requests. Record the action taken before closing a case.</p>
        </div>
        <Button type="button" variant="outline" size="sm" icon={RefreshCw} onClick={loadRequests} loading={loading} disabled={loading}>Refresh</Button>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      {loading ? (
        <Card><p role="status" className="py-8 text-center text-sm text-espresso/60">Loading privacy requests…</p></Card>
      ) : items.length ? (
        <div className="grid gap-3">
          {items.map(item => {
            const terminal = ['COMPLETED', 'REJECTED'].includes(item.status);
            return (
              <Card key={item.id} className="!p-4 md:!p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardHeader title={`${item.request_type} request`} subtitle={`${item.customer_name} · ${item.customer_email}`} className="mb-2" />
                    <p className="whitespace-pre-wrap text-sm text-espresso/75">{item.details || 'No additional details supplied.'}</p>
                    <p className="mt-2 text-[11px] text-espresso/45">Submitted {new Date(item.created_at).toLocaleString()}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${statusClass[item.status] || 'bg-cream text-espresso'}`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <Textarea
                    label="Review notes / action taken"
                    rows={2}
                    maxLength={4000}
                    value={notes[item.id] ?? item.response_notes ?? ''}
                    onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))}
                    disabled={terminal || savingId === item.id}
                  />
                  <div className="flex flex-wrap gap-2">
                    {!terminal && <Button type="button" variant="outline" size="sm" icon={ShieldCheck} onClick={() => updateStatus(item, 'IN_PROGRESS')} loading={savingId === item.id} disabled={savingId !== null}>Mark in progress</Button>}
                    {!terminal && <Button type="button" variant="gold" size="sm" icon={Check} onClick={() => updateStatus(item, 'COMPLETED')} loading={savingId === item.id} disabled={savingId !== null}>Complete</Button>}
                    {!terminal && <Button type="button" variant="ghost" size="sm" icon={X} className="text-red-600" onClick={() => updateStatus(item, 'REJECTED')} loading={savingId === item.id} disabled={savingId !== null}>Reject</Button>}
                  </div>
                </div>
                {item.response_notes && terminal && <p className="mt-3 rounded-xl bg-cream p-3 text-xs text-espresso/70"><strong>Recorded response:</strong> {item.response_notes}</p>}
              </Card>
            );
          })}
        </div>
      ) : error ? (
        <EmptyState icon={ShieldCheck} title="Privacy queue unavailable" description="Check the connection and try again." />
      ) : (
        <EmptyState icon={ShieldCheck} title="No privacy requests" description="New customer requests will appear here for review." />
      )}
    </div>
  );
}
