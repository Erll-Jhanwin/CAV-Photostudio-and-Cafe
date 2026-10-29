import React, { useEffect, useState } from 'react';
import { Search, RefreshCw, ClipboardList, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/Skeleton';
import { formatManilaDateTime } from '../../utils/dateTime';

const sensitiveMetadataKey = /(password|passwd|otp|token|secret|authorization|cookie|credential|proof|file|image|base64|email|phone|mobile|address|ip_address|session|component_stack|stack|traceback|receipt|username|(^|_)name$)/i;
const sensitiveMetadataValue = /(Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi;
const emailValue = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phoneValue = /\+?\d[\d ()-]{7,}\d/g;
const missingValue = 'Not recorded';

const sanitizeAuditDetail = (value, key = '', depth = 0) => {
  if (sensitiveMetadataKey.test(key)) return undefined;
  if (depth > 5) return '[nested details omitted]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeAuditDetail(item, '', depth + 1)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80)
      .map(([nestedKey, nestedValue]) => [nestedKey, sanitizeAuditDetail(nestedValue, nestedKey, depth + 1)])
      .filter(([, nestedValue]) => nestedValue !== undefined));
  }
  if (typeof value === 'string') {
    return value
      .replace(sensitiveMetadataValue, '[redacted credential]')
      .replace(emailValue, '[redacted email]')
      .replace(phoneValue, '[redacted phone]')
      .slice(0, 2000);
  }
  return value;
};

const pickMetadataValue = (metadata, keys) => {
  for (const key of keys) {
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, key) && metadata[key] !== null && metadata[key] !== '') {
      return sanitizeAuditDetail(metadata[key], key);
    }
  }
  return undefined;
};

const displayAuditValue = value => {
  if (value === undefined || value === null || value === '') return missingValue;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const AuditDetailField = ({ label, value, multiline = false }) => (
  <div className="min-w-0 rounded-xl border border-espresso/[0.07] bg-white p-3">
    <p className="text-[9px] font-black uppercase tracking-wider text-espresso/45">{label}</p>
    {multiline ? (
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-espresso/75">{displayAuditValue(value)}</pre>
    ) : (
      <p className="mt-1 break-words text-xs leading-relaxed text-espresso/75">{displayAuditValue(value)}</p>
    )}
  </div>
);

function AuditLogDetailsModal({ event, onClose }) {
  if (!event) return null;
  const metadata = event.details && typeof event.details === 'object' && !Array.isArray(event.details) ? event.details : {};
  const safeMetadata = sanitizeAuditDetail(metadata) || {};
  const errorMessage = pickMetadataValue(metadata, ['error_message', 'storage_error', 'error', 'message', 'detail']);
  const errorCause = pickMetadataValue(metadata, ['cause', 'cause_type', 'exception_type', 'error_type', 'issue', 'reason']);
  const recovery = pickMetadataValue(metadata, ['recovery_actions', 'recovery_action', 'recovery', 'recommended_action', 'suggested_action', 'next_step']);
  const before = pickMetadataValue(metadata, ['before', 'old_values', 'previous_values', 'old_data']);
  const after = pickMetadataValue(metadata, ['after', 'new_values', 'updated_values', 'new_data']);
  const changedFields = pickMetadataValue(metadata, ['changed_fields', 'change_summary']);
  const outcomeValue = pickMetadataValue(metadata, ['outcome', 'result', 'status', 'success', 'printed', 'approved']);
  const actionText = String(event.action || '').toUpperCase();
  const isError = /ERROR|FAILED|FAILURE/.test(actionText) || Boolean(errorMessage || errorCause);
  const isWarning = !isError && (/WARN|WARNING|ISSUE/.test(actionText) || metadata.verification_issue === true || Boolean(metadata.warning));
  const errorClassName = isError
    ? 'bg-red-50 text-red-700'
    : isWarning ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700';
  const visibleMetadata = Object.entries(safeMetadata).filter(([key]) => ![
    'before', 'old_values', 'previous_values', 'old_data', 'after', 'new_values', 'updated_values', 'new_data',
    'changed_fields', 'change_summary', 'outcome', 'result', 'status', 'success', 'printed', 'approved',
    'error_message', 'storage_error', 'error', 'message', 'detail', 'cause', 'cause_type', 'exception_type',
    'error_type', 'issue', 'reason', 'recovery_actions', 'recovery_action', 'recovery', 'recommended_action',
    'suggested_action', 'next_step',
  ].includes(key));

  return (
    <Modal
      open={Boolean(event)}
      onClose={onClose}
      title={`Audit event · ${event.action || 'Action not recorded'}`}
      size="5xl"
      className="max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden"
      bodyClassName="max-h-[calc(100vh-8rem)] max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto p-4 sm:p-6"
    >
      <section className="rounded-2xl border border-espresso/10 bg-cream/45 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-espresso">{event.action || missingValue}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-espresso/65">{event.description || missingValue}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black ${errorClassName}`}>
            {isError ? 'Error' : isWarning ? 'Warning' : 'Recorded event'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <AuditDetailField label="Timestamp" value={event.timestamp ? formatManilaDateTime(event.timestamp) : undefined} />
          <AuditDetailField label="Actor" value={event.name} />
          <AuditDetailField label="Actor user ID" value={event.user_id} />
          <AuditDetailField label="Actor role" value={event.role} />
          <AuditDetailField label="Action taken" value={event.action} />
          <AuditDetailField label="Affected module" value={event.module} />
          <AuditDetailField label="Affected record" value={event.record_reference} />
          <AuditDetailField label="Outcome" value={outcomeValue === undefined ? 'No explicit outcome recorded' : outcomeValue} />
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/30 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Changes</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <AuditDetailField label="Before" value={before} multiline />
          <AuditDetailField label="After" value={after} multiline />
        </div>
        <div className="mt-2"><AuditDetailField label="Changed fields / summary" value={changedFields} multiline /></div>
      </section>

      <section className={`rounded-2xl border p-4 ${isError || isWarning ? 'border-amber-200 bg-amber-50/50' : 'border-espresso/10 bg-cream/30'}`}>
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">{isError || isWarning ? 'Issue details' : 'Error details'}</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
          <AuditDetailField label="Recorded error message" value={errorMessage} multiline />
          <AuditDetailField label="Recorded cause" value={errorCause} multiline />
          <AuditDetailField label="Recovery actions" value={recovery} multiline />
        </div>
      </section>

      <section className="rounded-2xl border border-espresso/10 bg-cream/30 p-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-espresso">Relevant metadata</h3>
        {visibleMetadata.length ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {visibleMetadata.map(([key, value]) => <AuditDetailField key={key} label={key.replace(/_/g, ' ')} value={value} multiline={typeof value === 'object'} />)}
          </div>
        ) : <p className="mt-2 text-xs text-espresso/55">No additional safe metadata was recorded.</p>}
      </section>
    </Modal>
  );
}

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
  const [selectedEvent, setSelectedEvent] = useState(null);

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
                  <tr
                    key={row.id}
                    tabIndex={0}
                    aria-label={`View audit event ${row.action || 'details'}`}
                    onClick={() => setSelectedEvent(row)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedEvent(row);
                      }
                    }}
                    className="cursor-pointer border-t border-espresso/[0.06] align-top hover:bg-cream/40 focus-visible:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-espresso/70">{formatManilaDateTime(row.timestamp)}</td>
                    <td className="px-4 py-3.5"><div className="font-bold text-espresso">{row.name || 'System'}</div><div className="mt-1 text-[10px] text-espresso/45">ID {row.user_id ?? '—'}</div></td>
                    <td className="px-4 py-3.5"><span className="rounded-full bg-cream px-2.5 py-1 font-black text-espresso/65">{row.role || 'SYSTEM'}</span></td>
                    <td className="px-4 py-3.5"><div className="font-black text-espresso">{row.action || missingValue}</div><div className="mt-1 max-w-sm text-espresso/55">{sanitizeAuditDetail(row.description) || missingValue}</div></td>
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
      <AuditLogDetailsModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
