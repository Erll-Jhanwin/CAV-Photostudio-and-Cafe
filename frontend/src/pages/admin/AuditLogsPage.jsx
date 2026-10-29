import React, { useEffect, useState } from 'react';
import { Search, RefreshCw, ClipboardList, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { LoadingSpinner } from '../../components/ui/Skeleton';
import { formatManilaDateTime } from '../../utils/dateTime';

const roleOptions = [
  { value: '', label: 'All roles' }, { value: 'ADMIN', label: 'Admin' },
  { value: 'STAFF', label: 'Staff' }, { value: 'CUSTOMER', label: 'Customer' },
  { value: 'SYSTEM', label: 'System' },
];
const kindOptions = [
  { value: '', label: 'All activity' },
  { value: 'errors', label: 'Errors and issues' },
];
const moduleOptions = [
  { value: '', label: 'All modules' }, { value: 'auth', label: 'Authentication' },
  { value: 'bookings', label: 'Bookings' }, { value: 'inventory', label: 'Inventory' },
  { value: 'pos', label: 'POS & transactions' }, { value: 'users', label: 'Accounts' },
  { value: 'notifications', label: 'Notifications' }, { value: 'chatbot', label: 'Chatbot' },
  { value: 'privacy', label: 'Privacy' }, { value: 'system', label: 'System' },
];

export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [kind, setKind] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [payload, setPayload] = useState({ count: 0, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      client.get('/api/audit/logs/', { params: { search, role, module, action, kind, start, end, page, page_size: pageSize } })
        .then(response => { if (active) { setPayload(response.data); setError(''); } })
        .catch(err => { if (active) setError(getApiErrorMessage(err, 'Could not load audit logs.')); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, role, module, action, kind, start, end, page, pageSize, refreshKey]);

  const setFilter = (setter) => (event) => { setter(event.target.value); setPage(1); };
  const totalPages = Math.max(1, Math.ceil((payload.count || 0) / pageSize));
  const clearFilters = () => { setSearch(''); setRole(''); setModule(''); setAction(''); setKind(''); setStart(''); setEnd(''); setPage(1); };

  return (
    <div className="w-full min-w-0 space-y-5 animate-in-up">
      <Card className="w-full min-w-0 overflow-hidden p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <CardHeader headingLevel={1} title="Audit Logs" subtitle="A searchable record of account, booking, payment, inventory, and system activity." className="mb-0" />
          </div>
          <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-espresso/10 bg-white px-3 py-2 text-xs font-bold text-espresso hover:bg-cream" aria-label="Refresh audit logs">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 2xl:grid-cols-8">
          <div className="relative min-w-0 sm:col-span-2 lg:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-espresso/40" />
            <Input aria-label="Search audit logs" placeholder="Search person, action, record…" value={search} onChange={setFilter(setSearch)} className="min-w-0 pl-9" />
          </div>
          <div className="min-w-0"><Select aria-label="Filter by role" value={role} onChange={setFilter(setRole)} options={roleOptions} className="min-w-0" /></div>
          <div className="min-w-0"><Select aria-label="Filter by module" value={module} onChange={setFilter(setModule)} options={moduleOptions} className="min-w-0" /></div>
          <div className="min-w-0"><Select aria-label="Filter activity type" value={kind} onChange={setFilter(setKind)} options={kindOptions} className="min-w-0" /></div>
          <div className="min-w-0"><Input aria-label="Filter by action" placeholder="Action (e.g. BOOKING_CREATE)" value={action} onChange={setFilter(setAction)} className="min-w-0" /></div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-2 2xl:col-span-2">
            <Input aria-label="Start date" type="date" value={start} onChange={setFilter(setStart)} className="min-w-0" />
            <Input aria-label="End date" type="date" value={end} onChange={setFilter(setEnd)} className="min-w-0" />
          </div>
        </div>
        <div className="mt-3 flex min-w-0 flex-col gap-2 text-xs text-espresso/55 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex min-w-0 items-center gap-1.5"><Filter className="h-3.5 w-3.5 shrink-0" /> {payload.count || 0} recorded activities</span>
          <button type="button" onClick={clearFilters} className="shrink-0 self-start font-bold text-gold-dark hover:underline sm:self-auto">Clear filters</button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {error && <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
        {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm font-semibold text-espresso/55"><LoadingSpinner size="sm" /> Loading audit activity…</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-cream text-[10px] uppercase tracking-wider text-espresso/55"><tr>
                  <th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Action</th><th className="px-4 py-3">Module / record</th><th className="px-4 py-3">Change details</th>
                </tr></thead>
                <tbody>{(payload.results || []).map(row => (
                  <tr key={row.id} className="border-t border-espresso/[0.06] align-top hover:bg-cream/40">
                    <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-espresso/70">{formatManilaDateTime(row.timestamp)}</td>
                    <td className="px-4 py-3.5"><div className="font-bold text-espresso">{row.name || 'System'}</div><div className="mt-1 text-[10px] text-espresso/45">ID {row.user_id ?? '—'}</div></td>
                    <td className="px-4 py-3.5"><span className="rounded-full bg-cream px-2.5 py-1 font-black text-espresso/65">{row.role || 'SYSTEM'}</span></td>
                    <td className="px-4 py-3.5"><div className="font-black text-espresso">{row.action}</div><div className="mt-1 max-w-sm text-espresso/55">{row.description}</div></td>
                    <td className="px-4 py-3.5"><div className="font-bold capitalize text-espresso/75">{String(row.module || '').replaceAll('_', ' ')}</div><div className="mt-1 text-espresso/50">{row.record_reference ? `#${row.record_reference}` : '—'}</div></td>
                    <td className="px-4 py-3.5 text-espresso/65">{row.details?.changed_fields?.length ? row.details.changed_fields.join(', ') : row.details?.change_summary || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {!payload.results?.length && !error && <div className="p-10"><div className="mx-auto max-w-md text-center"><ClipboardList className="mx-auto h-8 w-8 text-espresso/25" /><p className="mt-2 font-black text-espresso">No audit activity found</p><p className="mt-1 text-xs text-espresso/55">Try changing or clearing the filters.</p></div></div>}
            <div className="flex flex-col gap-3 border-t border-espresso/[0.06] px-4 py-3 text-xs text-espresso/60 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2"><span>Rows per page</span><select aria-label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-espresso/10 bg-white px-2 py-1"><option>10</option><option>25</option><option>50</option><option>100</option></select><span>Page {page} of {totalPages}</span></div>
              <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-espresso/10 p-2 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-espresso/10 p-2 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
