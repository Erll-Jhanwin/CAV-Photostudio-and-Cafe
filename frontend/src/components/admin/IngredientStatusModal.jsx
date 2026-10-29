import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, RefreshCw, Search } from 'lucide-react';
import client, { getApiErrorMessage } from '../../api/client';
import { EmptyState } from '../ui/EmptyState';
import { Input, Select } from '../ui/Input';
import { LoadingSpinner } from '../ui/Skeleton';
import { Modal } from '../ui/Modal';
import { sortRows } from '../ui/DataTable';

const PAGE_SIZE = 300;
const sortOptions = [
  { value: 'expiration_date_asc', label: 'Expiration date · oldest first' },
  { value: 'expiration_date_desc', label: 'Expiration date · newest first' },
  { value: 'name_asc', label: 'Ingredient name · A to Z' },
  { value: 'name_desc', label: 'Ingredient name · Z to A' },
  { value: 'quantity_asc', label: 'Quantity · low to high' },
  { value: 'quantity_desc', label: 'Quantity · high to low' },
];

const statusStyles = {
  EXPIRED: 'border-red-200 bg-red-50 text-red-700',
  NEAR_EXPIRY: 'border-orange-200 bg-orange-50 text-orange-700',
  LOW_STOCK: 'border-amber-200 bg-amber-50 text-amber-800',
  OVERSTOCKED: 'border-blue-200 bg-blue-50 text-blue-700',
  IN_STOCK: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const formatQuantity = (value) => Number(value || 0).toLocaleString('en-PH', {
  maximumFractionDigits: 2,
});

const unitLabel = (value) => ({ G: 'g', ML: 'mL' }[String(value || '').toUpperCase()] || value || '—');

const emptyStateFor = (statusLabel) => ({
  title: `No ${statusLabel.toLocaleLowerCase()} ingredients`,
  description: `There are currently no ingredients with ${statusLabel.toLocaleLowerCase()} stock status.`,
});

export default function IngredientStatusModal({ open, onClose, statusKey = 'EXPIRED', statusLabel = 'Expired' }) {
  const [ingredients, setIngredients] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('expiration_date_asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const loadExpiredIngredients = async () => {
      setLoading(true);
      setError('');
      try {
        const rows = [];
        let offset = 0;
        let batch = [];
        do {
          const response = await client.get('/api/inventory/ingredients/', {
            params: { limit: PAGE_SIZE, offset },
          });
          batch = Array.isArray(response.data) ? response.data : response.data?.results || [];
          rows.push(...batch);
          offset += batch.length;
        } while (active && batch.length === PAGE_SIZE);
        if (active) setIngredients(rows.filter(row => row.inventory_status === statusKey));
      } catch (requestError) {
        if (active) setError(getApiErrorMessage(requestError, 'Could not load expired ingredients.'));
      } finally {
        if (active) setLoading(false);
      }
    };
    loadExpiredIngredients();
    return () => { active = false; };
  }, [open, refreshKey, statusKey]);

  const visibleIngredients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = ingredients.filter(row => (
      !query || [row.name, row.base_unit, row.inventory_status_label, row.expiration_date]
        .some(value => String(value || '').toLocaleLowerCase().includes(query))
    ));
    const key = sort.replace(/_(asc|desc)$/, '');
    const direction = sort.endsWith('_asc') ? 'asc' : 'desc';
    const sortKey = key === 'quantity' ? 'stock_quantity' : key;
    return sortRows(filtered, { key: sortKey, dir: direction });
  }, [ingredients, search, sort]);
  const emptyState = emptyStateFor(statusLabel);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${statusLabel} Ingredients`}
      size="2xl"
      className="max-h-[calc(100dvh-2rem)] overflow-hidden"
      bodyClassName="!p-4 sm:!p-6 max-h-[calc(100dvh-9rem)]"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-espresso/40" aria-hidden="true" />
            <Input
              aria-label={`Search ${statusLabel.toLocaleLowerCase()} ingredients`}
              placeholder="Search ingredient, unit, date..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="min-w-0 pl-9"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:w-[19rem] sm:flex-none">
            <label htmlFor="expired-ingredient-sort" className="shrink-0 text-xs font-bold text-espresso/60">Sort</label>
            <Select
              id="expired-ingredient-sort"
              aria-label={`Sort ${statusLabel.toLocaleLowerCase()} ingredients`}
              value={sort}
              onChange={event => setSort(event.target.value)}
              options={sortOptions}
              className="min-w-0 py-2.5 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm font-semibold text-espresso/55">
            <LoadingSpinner size="sm" /> Loading current ingredient stock...
          </div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            <p>{error}</p>
            <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="mt-3 font-black text-red-800 underline">Try again</button>
          </div>
        ) : ingredients.length === 0 ? (
          <EmptyState
            icon={Package}
            title={emptyState.title}
            description={emptyState.description}
          />
        ) : visibleIngredients.length === 0 ? (
          <EmptyState
            icon={Search}
            title={`No matching ${statusLabel.toLocaleLowerCase()} ingredients`}
            description="Try a different search term or clear your search."
          />
        ) : (
          <>
            <p className="text-xs font-semibold text-espresso/55" aria-live="polite">
              Showing {visibleIngredients.length} of {ingredients.length} {statusLabel.toLocaleLowerCase()} ingredient{ingredients.length === 1 ? '' : 's'}
            </p>
            <div className="hidden max-h-[55vh] overflow-auto rounded-2xl border border-espresso/[0.08] md:block">
              <table className="w-full min-w-[650px] text-left text-xs">
                <thead className="sticky top-0 bg-cream text-[10px] uppercase tracking-wider text-espresso/55">
                  <tr>
                    <th className="px-4 py-3">Ingredient</th>
                    <th className="px-4 py-3 text-right">Current quantity</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Expiration date</th>
                    <th className="px-4 py-3">Stock status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIngredients.map(row => (
                    <tr key={row.id} className="border-t border-espresso/[0.06]">
                      <td className="px-4 py-3 font-bold text-espresso">{row.name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-espresso/75">{formatQuantity(row.stock_quantity)}</td>
                      <td className="px-4 py-3 text-espresso/70">{unitLabel(row.base_unit)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-espresso/70">{formatDate(row.expiration_date)}</td>
                      <td className="px-4 py-3"><StatusPill row={row} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="max-h-[55vh] space-y-3 overflow-y-auto md:hidden">
              {visibleIngredients.map(row => (
                <article key={row.id} className="rounded-2xl border border-espresso/[0.08] bg-cream/40 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-sm font-black text-espresso">{row.name}</h3>
                    <StatusPill row={row} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div><dt className="text-espresso/45">Current quantity</dt><dd className="mt-0.5 font-bold text-espresso">{formatQuantity(row.stock_quantity)}</dd></div>
                    <div><dt className="text-espresso/45">Unit</dt><dd className="mt-0.5 font-bold text-espresso">{unitLabel(row.base_unit)}</dd></div>
                    <div className="col-span-2"><dt className="text-espresso/45">Expiration date</dt><dd className="mt-0.5 font-bold text-espresso">{formatDate(row.expiration_date)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-espresso/[0.06] pt-4 sm:flex-row sm:justify-between">
          <button type="button" onClick={() => setRefreshKey(value => value + 1)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-espresso/10 px-4 py-2.5 text-xs font-bold text-espresso hover:bg-cream disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh stock
          </button>
          <button type="button" onClick={onClose} className="rounded-xl bg-espresso px-4 py-2.5 text-xs font-black text-cream hover:bg-espresso-light">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function StatusPill({ row }) {
  const label = row.inventory_status_label || row.inventory_status || 'Unknown';
  const className = statusStyles[row.inventory_status] || 'border-espresso/10 bg-cream text-espresso/70';
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black ${className}`}><AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />{label}</span>;
}
