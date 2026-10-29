import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Package, Printer, RefreshCw, Search, Trash2, X } from 'lucide-react';
import client from '../../api/client';
import { MANILA_TIME_ZONE } from '../../utils/dateTime';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TIME_ZONE });
const stamp = value => value ? new Date(value).toLocaleString(undefined, { timeZone: MANILA_TIME_ZONE }) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export default function DailyInventoryBoard({ user }) {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [countDrafts, setCountDrafts] = useState({});
  const [closeOpen, setCloseOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionProduct, setCorrectionProduct] = useState('');
  const [correctionQuantity, setCorrectionQuantity] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionKey, setCorrectionKey] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lossOpen, setLossOpen] = useState(false);
  const [lossProduct, setLossProduct] = useState(null);
  const [lossQuantity, setLossQuantity] = useState('1');
  const [lossReason, setLossReason] = useState('');
  const [lossIdempotencyKey, setLossIdempotencyKey] = useState('');
  const canReview = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await client.get('/api/inventory/daily-reconciliation/', { params: { date } });
      setData(response.data);
      setCountDrafts(Object.fromEntries((response.data.rows || []).map(row => [row.product_id, row.actual_ending ?? ''])));
    } catch (e) { setError(e.response?.data?.detail || 'Could not load the daily inventory report.'); }
    finally { setBusy(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.rows || []).filter(row => {
    const matchesText = !search || row.product_name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'ALL' || (filter === 'DISCREPANCY' ? row.variance !== null && row.variance !== 0 : row.tally_status === filter);
    return matchesText && matchesFilter;
  }), [data, search, filter]);
  const discrepancies = (data?.rows || []).filter(row => row.variance !== null && row.variance !== 0).length;
  const counted = (data?.rows || []).filter(row => row.actual_ending !== null).length;

  const submit = async (payload) => {
    setBusy(true); setError('');
    try { const response = await client.post('/api/inventory/daily-reconciliation/', { date, ...payload }); await load(); return response.data; }
    catch (e) { setError(e.response?.data?.detail || 'The inventory update could not be saved.'); return false; }
    finally { setBusy(false); }
  };
  const saveCount = (row) => {
    const value = countDrafts[row.product_id];
    if (value === '' || !Number.isInteger(Number(value)) || Number(value) < 0) { setError('Enter a whole number count of zero or more.'); return; }
    void submit({ action: 'COUNT', product_id: row.product_id, quantity: Number(value) });
  };
  const recordWaste = async (e) => {
    e.preventDefault();
    if (!lossReason.trim() || !Number.isInteger(Number(lossQuantity)) || Number(lossQuantity) <= 0) return;
    if (await submit({ action: 'LOSS', product_id: lossProduct.product_id, quantity: Number(lossQuantity), reason: lossReason.trim(), idempotency_key: lossIdempotencyKey })) {
      setLossOpen(false); setLossReason(''); setLossProduct(null); setLossIdempotencyKey('');
    }
  };
  const closeDay = async () => {
    const printWindow = window.open('', '_blank');
    const saved = await submit({ action: 'CLOSE', remarks });
    if (saved) {
      setCloseOpen(false);
      printSaved(saved.report || saved, printWindow);
    } else if (printWindow) printWindow.close();
  };
  const saveCorrection = async (e) => {
    e.preventDefault();
    if (!correctionProduct || !correctionReason.trim() || !Number.isInteger(Number(correctionQuantity)) || Number(correctionQuantity) < 0) return;
    const result = await submit({ action: 'CORRECTION', product_id: Number(correctionProduct), quantity: Number(correctionQuantity), reason: correctionReason.trim(), idempotency_key: correctionKey });
    if (result) { setCorrectionOpen(false); setCorrectionReason(''); setCorrectionKey(''); }
  };
  const printSaved = (savedReport = data?.report || (data?.is_closed ? data : null), targetWindow = null) => {
    if (!savedReport) return;
    const report = savedReport;
    const tableRows = report.rows.map(row => `<tr><td>${escapeHtml(row.product_name)}</td><td>${escapeHtml(row.beginning_inventory)}</td><td>${escapeHtml(row.net_sold)}</td><td>${escapeHtml(row.loss_qty)}</td><td>${escapeHtml(row.expected_ending)}</td><td>${escapeHtml(row.actual_ending)}</td><td>${escapeHtml(row.variance)}</td><td>${escapeHtml(row.tally_status)}</td></tr>`).join('');
    const losses = report.rows.flatMap(row => (row.losses || []).map(loss => `<tr><td>${escapeHtml(row.product_name)}</td><td>${escapeHtml(loss.transaction_number || '—')}</td><td>${escapeHtml(stamp(loss.created_at))}</td><td>${escapeHtml(loss.loss_type)}</td><td>${escapeHtml(loss.quantity)}</td><td>${escapeHtml(loss.remarks)}</td><td>${escapeHtml(loss.staff_member)}</td></tr>`)).join('');
    const corrections = (report.corrections || data?.corrections || []).map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.previous_quantity)}</td><td>${escapeHtml(item.corrected_quantity)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.actor)}</td><td>${escapeHtml(stamp(item.created_at))}</td></tr>`).join('');
    const w = targetWindow || window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print this saved report. The day remains closed.'); return; }
    w.document.write(`<!doctype html><html><head><title>Product inventory ${escapeHtml(report.date)}</title><style>body{font:12px Arial,sans-serif;color:#222;margin:20mm}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin:14px 0 24px}th,td{border:1px solid #777;padding:6px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.meta{line-height:1.7}@media print{body{margin:12mm}}</style></head><body><h1>Daily Product Inventory</h1><div class="meta">Business date: ${escapeHtml(report.date)}<br>Closed by: ${escapeHtml(report.closed_by)}<br>Closed at: ${escapeHtml(stamp(report.closed_at))}<br>Discrepancy remarks: ${escapeHtml(report.discrepancy_remarks || '—')}</div><table><thead><tr><th>Product</th><th>Beginning</th><th>Net sold</th><th>Loss qty</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table><h2>Loss details</h2><table><thead><tr><th>Product</th><th>Transaction</th><th>Date and time</th><th>Type</th><th>Qty</th><th>Reason</th><th>Staff</th></tr></thead><tbody>${losses || '<tr><td colspan="7">No losses recorded</td></tr>'}</tbody></table>${corrections ? `<h2>Authorized corrections</h2><table><thead><tr><th>Product</th><th>Before</th><th>Corrected</th><th>Reason</th><th>Admin</th><th>Date and time</th></tr></thead><tbody>${corrections}</tbody></table>` : ''}<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return <section className="space-y-4" aria-label="Daily product inventory reconciliation">
    <div className="flex flex-col gap-3 rounded-2xl border border-espresso/10 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-lg font-black text-espresso">Daily Product Reconciliation</h2><p className="mt-1 text-xs text-espresso/55">Product stock movement, physical counts, and saved close reports.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-espresso/70">Business date<input className="mt-1 block rounded-lg border border-espresso/15 bg-white px-3 py-2 text-sm" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <button type="button" onClick={load} className="inline-flex h-10 items-center gap-2 rounded-lg border border-espresso/15 px-3 text-sm font-bold text-espresso"><RefreshCw size={15} /> Refresh</button>
        {data?.is_closed ? <><button type="button" onClick={() => printSaved()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-espresso px-3 text-sm font-bold text-white"><Printer size={15} /> Reprint saved report</button>{canReview && <button type="button" onClick={()=>{setCorrectionProduct(String(data.rows?.[0]?.product_id || ''));setCorrectionQuantity(String(data.rows?.[0]?.actual_ending ?? ''));setCorrectionKey(window.crypto?.randomUUID?.() || `${Date.now()}-${date}`);setCorrectionOpen(true);}} className="inline-flex h-10 items-center gap-2 rounded-lg border border-espresso/20 px-3 text-sm font-bold text-espresso">Correct finalized count</button>}</> : <button type="button" onClick={() => setCloseOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-espresso px-3 text-sm font-bold text-white" disabled={busy}><ClipboardCheck size={15} /> Close Day &amp; Print Report</button>}
      </div>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-3 py-1.5 font-bold ${data?.is_closed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{data?.is_closed ? `Closed${data.closed_at ? ` · ${stamp(data.closed_at)}` : ''}` : 'Open'}</span><span className="rounded-full bg-cream px-3 py-1.5 font-bold text-espresso">{counted}/{data?.rows?.length || 0} counted</span><span className={`rounded-full px-3 py-1.5 font-bold ${discrepancies ? 'bg-red-100 text-red-800' : 'bg-cream text-espresso'}`}>{discrepancies} discrepancies</span></div>
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-espresso/45" /><input aria-label="Search products" className="w-full rounded-xl border border-espresso/15 bg-white py-2.5 pl-9 pr-3 text-sm" placeholder="Search products" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <select aria-label="Filter tally status" className="rounded-xl border border-espresso/15 bg-white px-3 py-2 text-sm" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">All statuses</option><option value="Not Counted">Not Counted</option><option value="Tally">Tally</option><option value="DISCREPANCY">Discrepancies</option></select>
    </div>
    <div className="max-h-[65vh] overflow-auto rounded-2xl border border-espresso/10 bg-white shadow-sm"><table className="w-full min-w-[1050px] border-collapse text-left text-sm"><thead className="sticky top-0 z-10 bg-cream text-[11px] uppercase tracking-wide text-espresso/65"><tr>{['Product','Beginning Inventory','Net Sold','Loss Qty','Expected Ending','Actual Ending','Variance','Tally Status',''].map((h,i)=><th key={h||i} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.product_id} className="border-t border-espresso/10"><td className="px-3 py-3"><button type="button" className="font-bold text-espresso underline decoration-espresso/30 underline-offset-2" onClick={() => setSelected(row)}>{row.product_name}</button><span className="ml-1 text-xs text-espresso/45">{row.unit}</span></td><td className="px-3 text-right">{row.beginning_inventory}</td><td className="px-3 text-right">{row.net_sold}</td><td className="px-3 text-right">{row.loss_qty}</td><td className="px-3 text-right">{row.expected_ending}</td><td className="px-3 text-right">{data?.is_closed ? row.actual_ending : <input aria-label={`Actual ending ${row.product_name}`} className="w-20 rounded-md border border-espresso/20 px-2 py-1 text-right" type="number" step="1" min="0" value={countDrafts[row.product_id] ?? ''} onChange={e=>setCountDrafts(d=>({...d,[row.product_id]:e.target.value}))} disabled={busy} />}</td><td className={`px-3 text-right font-bold ${row.variance < 0 ? 'text-red-700' : row.variance > 0 ? 'text-amber-700' : ''}`}>{row.variance === null ? '—' : row.variance > 0 ? `+${row.variance}` : row.variance}</td><td className="px-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${row.tally_status === 'Tally' ? 'bg-emerald-100 text-emerald-800' : row.tally_status === 'Not Counted' ? 'bg-cream text-espresso/65' : 'bg-red-100 text-red-800'}`}>{row.tally_status}</span></td><td className="px-3"><div className="flex gap-1">{!data?.is_closed && <><button type="button" onClick={()=>saveCount(row)} className="rounded-md border px-2 py-1 text-xs font-bold" disabled={busy}>Save count</button><button type="button" title={`Record waste for ${row.product_name}`} onClick={()=>{setLossProduct(row);setLossOpen(true);setLossIdempotencyKey(window.crypto?.randomUUID?.() || `${Date.now()}-${row.product_id}`);}} className="rounded-md border px-2 py-1 text-xs font-bold" disabled={busy}><Trash2 size={14}/></button></>}</div></td></tr>)}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-espresso/55"><Package className="mx-auto mb-2"/>No products match this view.</div>}</div>

    {selected && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setSelected(null)}><section role="dialog" aria-modal="true" aria-labelledby="loss-heading" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"><header className="flex items-center justify-between border-b p-4"><div><h3 id="loss-heading" className="text-lg font-black">{selected.product_name} · {date}</h3><p className="text-xs text-espresso/55">Total lost: {selected.loss_qty} {selected.unit}</p></div><button aria-label="Close loss details" onClick={()=>setSelected(null)}><X/></button></header><div className="min-h-0 flex-1 overflow-auto p-4"><h4 className="mb-2 font-bold">Loss events</h4>{selected.losses?.length ? <div className="space-y-2">{selected.losses.map(event=><article key={event.id} className="rounded-xl border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2 font-bold"><span>{event.loss_type} · {event.quantity} {selected.unit}</span><span className="text-xs font-normal text-espresso/55">{stamp(event.created_at)}</span></div><p className="mt-1">{event.remarks}</p><p className="mt-1 text-xs text-espresso/60">{event.transaction_number ? `Transaction ${event.transaction_number} · ` : ''}Recorded by {event.staff_member}{event.restock_disposition ? ` · ${event.restock_disposition}` : ''}{event.related_reference ? ` · Related ${event.related_reference}` : ''}</p></article>)}</div> : <p className="rounded-xl bg-cream p-5 text-center text-sm text-espresso/60">No losses recorded for this product on this business date.</p>}<h4 className="mb-2 mt-5 font-bold">Stock movements</h4>{selected.movements?.length ? <div className="space-y-2">{selected.movements.map(event=><p key={event.id} className="rounded-lg border p-2 text-sm">{event.type==='IN'?'+':'−'}{event.quantity} · {event.reason} <span className="text-xs text-espresso/55">· {stamp(event.created_at)} · {event.actor}</span></p>)}</div> : <p className="text-sm text-espresso/55">No additional stock movements.</p>}</div><footer className="border-t p-3 text-right"><button className="rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-white" onClick={()=>setSelected(null)}>Done</button></footer></section></div>}
    {lossOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3"><form onSubmit={recordWaste} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><h3 className="text-lg font-black">Record wastage</h3><p className="mb-4 text-sm text-espresso/60">{lossProduct?.product_name}</p><label className="mb-3 block text-sm font-bold">Quantity<input type="number" min="1" step="1" required value={lossQuantity} onChange={e=>setLossQuantity(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label><label className="block text-sm font-bold">Reason<textarea required value={lossReason} onChange={e=>setLossReason(e.target.value)} className="mt-1 w-full rounded-lg border p-2" rows="3"/></label><div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>setLossOpen(false)}>Cancel</button><button className="rounded-lg bg-espresso px-4 py-2 font-bold text-white" disabled={busy}>Save wastage</button></div></form></div>}
    {closeOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3"><section role="dialog" aria-modal="true" aria-labelledby="close-heading" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"><header className="flex items-center justify-between border-b p-4"><div><h3 id="close-heading" className="text-lg font-black">Close Day &amp; Print Report</h3><p className="text-sm text-espresso/60">Review the report for {date} before finalizing.</p></div><button aria-label="Close preview" onClick={()=>setCloseOpen(false)}><X/></button></header><div className="min-h-0 flex-1 overflow-auto p-4"><div className="mb-3 flex flex-wrap gap-3 text-sm"><span>{counted}/{data?.rows?.length || 0} products counted</span><span className={discrepancies?'font-bold text-red-700':'text-emerald-700'}>{discrepancies} discrepancies</span></div><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr><th className="p-2 text-left">Product</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th></tr></thead><tbody>{(data?.rows||[]).map(row=><tr key={row.product_id} className={`border-t ${row.variance?'bg-red-50':''}`}><td className="p-2">{row.product_name}</td><td className="text-center">{row.expected_ending}</td><td className="text-center">{row.actual_ending??'Not counted'}</td><td className="text-center">{row.variance??'—'}</td><td className="text-center">{row.tally_status}</td></tr>)}</tbody></table></div>{discrepancies>0 && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm"><AlertTriangle className="mr-1 inline" size={16}/>Only an admin can approve closing with discrepancies. Explain the variance below.<textarea className="mt-2 w-full rounded-lg border p-2" rows="3" value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Discrepancy explanation" /></div>}</div><footer className="flex justify-end gap-2 border-t p-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>setCloseOpen(false)}>Back to counts</button><button type="button" className="rounded-lg bg-espresso px-4 py-2 font-bold text-white disabled:opacity-40" onClick={closeDay} disabled={busy || counted !== (data?.rows?.length||0) || (discrepancies>0 && (!canReview || !remarks.trim()))}>Finalize day</button></footer></section></div>}
    {correctionOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3"><form onSubmit={saveCorrection} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"><header className="border-b p-4"><h3 className="text-lg font-black">Correct finalized count</h3><p className="mt-1 text-sm text-espresso/60">The saved report stays unchanged. This audited correction updates the effective carry-forward balance.</p></header><div className="min-h-0 flex-1 space-y-3 overflow-auto p-4"><label className="block text-sm font-bold">Product<select required className="mt-1 w-full rounded-lg border p-2" value={correctionProduct} onChange={e=>{setCorrectionProduct(e.target.value);const row=data.rows.find(item=>String(item.product_id)===e.target.value);setCorrectionQuantity(String(row?.actual_ending??''));}}>{(data?.rows||[]).map(row=><option key={row.product_id} value={row.product_id}>{row.product_name}</option>)}</select></label><label className="block text-sm font-bold">Correct ending quantity<input required type="number" min="0" step="1" className="mt-1 w-full rounded-lg border p-2" value={correctionQuantity} onChange={e=>setCorrectionQuantity(e.target.value)}/></label><label className="block text-sm font-bold">Reason<textarea required rows="3" className="mt-1 w-full rounded-lg border p-2" value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} /></label>{data?.corrections?.length > 0 && <div className="rounded-lg bg-cream p-3 text-xs"><p className="mb-2 font-bold">Previous corrections</p>{data.corrections.map(item=><p key={item.id} className="mb-1">{item.product_name}: {item.previous_quantity} → {item.corrected_quantity} · {item.reason} · {item.actor} · {stamp(item.created_at)}</p>)}</div>}</div><footer className="flex justify-end gap-2 border-t p-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>setCorrectionOpen(false)}>Cancel</button><button className="rounded-lg bg-espresso px-4 py-2 font-bold text-white" disabled={busy}>Save audited correction</button></footer></form></div>}
    {data?.is_closed && data.corrections?.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><h3 className="font-bold">Authorized corrections</h3>{data.corrections.map(item=><p key={item.id} className="mt-1">{item.product_name}: {item.previous_quantity} → {item.corrected_quantity} · {item.reason} · {item.actor} · {stamp(item.created_at)}</p>)}</div>}
  </section>;
}
