import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, AlertTriangle, CalendarOff, Clock, Package, PackageCheck, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { DataTable, PaginationControls, paginateRows, sortRows } from '../../components/ui/DataTable';
import ProductActivityModal from '../../components/inventory/ProductActivityModal';
import { calculateSalesRowsPerPage } from '../salesLogLayout';

const inventoryStatuses = [
  { key: 'IN_STOCK', label: 'In Stock', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: PackageCheck, iconClass: 'text-emerald-700 bg-emerald-50' },
  { key: 'LOW_STOCK', label: 'Low Stock', className: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle, iconClass: 'text-orange-700 bg-orange-50' },
  { key: 'NEAR_EXPIRY', label: 'Near Expiry', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, iconClass: 'text-amber-700 bg-amber-50' },
  { key: 'EXPIRED', label: 'Expired', className: 'bg-red-50 text-red-700 border-red-200', icon: CalendarOff, iconClass: 'text-red-700 bg-red-50' },
  { key: 'OVERSTOCKED', label: 'Overstocked', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: Archive, iconClass: 'text-blue-700 bg-blue-50' },
];

const formatCurrency = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function LiveInventoryPage({ ingredients = [], productSalesInventory = [], onRefresh, loading = false }) {
  const [section, setSection] = useState('management');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [inventoryPage, setInventoryPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(10);
  const [salesPageSize, setSalesPageSize] = useState(10);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const inventoryAreaRef = useRef(null);
  const salesAreaRef = useRef(null);

  const visibleIngredients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ingredients.filter(item => {
      const matchesSearch = String(item.name || '').toLowerCase().includes(query);
      return matchesSearch && (statusFilter === 'ALL' || item.inventory_status === statusFilter);
    });
  }, [ingredients, search, statusFilter]);
  const sortedIngredients = useMemo(() => sortRows(visibleIngredients, sort), [visibleIngredients, sort]);
  const pagedIngredients = paginateRows(sortedIngredients, inventoryPage, inventoryPageSize);
  const pagedSales = paginateRows(productSalesInventory, salesPage, salesPageSize);
  const inventoryCounts = useMemo(() => inventoryStatuses.reduce((counts, status) => {
    counts[status.key] = ingredients.filter(item => item.inventory_status === status.key).length;
    return counts;
  }, {}), [ingredients]);

  const toggleSort = (key, column) => setSort(current => current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc', accessor: column.sortAccessor }
    : { key, dir: 'asc', accessor: column.sortAccessor });

  useLayoutEffect(() => {
    const area = section === 'management' ? inventoryAreaRef.current : salesAreaRef.current;
    if (!area) return undefined;
    const setPageSize = section === 'management' ? setInventoryPageSize : setSalesPageSize;
    const measure = () => {
      const table = area.querySelector('table');
      const headerHeight = table?.querySelector('thead')?.getBoundingClientRect().height || 0;
      const rowHeights = Array.from(table?.querySelectorAll('tbody tr') || []).map(row => row.getBoundingClientRect().height);
      const nextSize = calculateSalesRowsPerPage({ availableHeight: area.clientHeight, headerHeight, rowHeights, defaultRowHeight: 54 });
      setPageSize(current => current === nextSize ? current : nextSize);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(area);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [section, inventoryPage, salesPage, inventoryPageSize, salesPageSize, sortedIngredients, productSalesInventory]);

  useLayoutEffect(() => {
    setInventoryPage(page => Math.min(page, Math.max(1, Math.ceil(visibleIngredients.length / inventoryPageSize))));
  }, [visibleIngredients.length, inventoryPageSize]);
  useLayoutEffect(() => {
    setSalesPage(page => Math.min(page, Math.max(1, Math.ceil(productSalesInventory.length / salesPageSize))));
  }, [productSalesInventory.length, salesPageSize]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden" data-testid="admin-live-inventory">
      <div className="flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="heading-page text-espresso">Live Inventory</h1>
          <p className="mt-1 text-xs text-espresso/50">Monitor stock levels, expiry risk, and today’s product sales, returns, and wastage.</p>
        </div>
        <Button variant="outline" size="sm" icon={RefreshCw} loading={loading} onClick={onRefresh}>Refresh Inventory</Button>
      </div>

      <div role="tablist" aria-label="Live Inventory sections" className="flex shrink-0 gap-2 overflow-x-auto border-b border-espresso/10">
        {[
          ['management', 'Inventory Management'],
          ['product-sales', 'Product Sales, Returns & Wastage'],
        ].map(([key, label]) => {
          const selected = section === key;
          return <button key={key} id={`admin-inventory-tab-${key}`} type="button" role="tab" aria-selected={selected} aria-controls={`admin-inventory-panel-${key}`} onClick={() => setSection(key)} className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-left text-xs font-black transition-colors sm:px-4 ${selected ? 'border-gold text-espresso' : 'border-transparent text-espresso/50 hover:text-espresso'}`}>{label}</button>;
        })}
      </div>

      {section === 'management' ? (
        <section role="tabpanel" id="admin-inventory-panel-management" aria-labelledby="admin-inventory-tab-management" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
            {inventoryStatuses.map(status => {
              const Icon = status.icon;
              const selected = statusFilter === status.key;
              return <button key={status.key} type="button" onClick={() => { setStatusFilter(current => current === status.key ? 'ALL' : status.key); setInventoryPage(1); }} aria-pressed={selected} className={`rounded-2xl border p-2.5 text-left shadow-sm transition-colors sm:p-3 ${selected ? 'border-espresso bg-espresso text-cream' : 'border-espresso/[0.05] bg-cream/60 text-espresso hover:border-gold/40'}`}>
                <div className="flex items-center justify-between gap-1"><span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${selected ? 'bg-gold/15 text-gold' : status.iconClass}`}><Icon className="h-4 w-4" /></span><span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${selected ? 'border-gold/30 bg-gold/10 text-gold' : status.className}`}>{status.label}</span></div>
                <p className={`mt-1.5 text-xl font-extrabold leading-tight ${selected ? 'text-white' : 'text-espresso'}`}>{inventoryCounts[status.key] || 0}</p>
                <p className={`text-[9px] font-black uppercase ${selected ? 'text-cream/55' : 'text-espresso/45'}`}>ingredients</p>
              </button>;
            })}
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-espresso/30" /><input aria-label="Search inventory" type="search" value={search} onChange={event => { setSearch(event.target.value); setInventoryPage(1); }} placeholder="Search ingredients..." className="w-full rounded-xl border border-espresso/10 bg-white py-2.5 pl-10 pr-4 text-xs transition-all focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/20" /></div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {inventoryStatuses.map(status => <button key={status.key} type="button" onClick={() => { setStatusFilter(statusFilter === status.key ? 'ALL' : status.key); setInventoryPage(1); }} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-black transition-all ${statusFilter === status.key ? 'border-espresso bg-espresso text-cream' : status.className}`}>{status.label}</button>)}
              <button type="button" onClick={() => { setStatusFilter('ALL'); setInventoryPage(1); }} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-black ${statusFilter === 'ALL' ? 'border-espresso bg-espresso text-cream' : 'border-espresso/10 bg-white text-espresso'}`}>All</button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-espresso/5 bg-white p-3 shadow-sm">
            <div ref={inventoryAreaRef} className="min-h-0 flex-1">
              <DataTable columns={[
                { key: 'name', label: 'Ingredient', render: item => <><p className="font-bold text-espresso">{item.name}</p><p className="text-[10px] text-espresso/45">Batch {item.batch_number || 'N/A'} · {item.supplier_details?.name || 'No supplier'}</p></> },
                { key: 'category_details.name', label: 'Category', render: item => item.category_details?.name || '-' },
                { key: 'stock_quantity', label: 'Quantity', align: 'center', render: item => `${Number(item.stock_quantity || 0).toLocaleString()} ${item.base_unit || ''}` },
                { key: 'minimum_stock_level', label: 'Min / Max', align: 'center', render: item => `${item.minimum_stock_level ?? 0} / ${item.maximum_stock_level ?? 0}` },
                { key: 'inventory_status_label', label: 'Status', render: item => <span className="inline-flex rounded-full border border-espresso/10 bg-cream px-2.5 py-1 text-[10px] font-bold text-espresso">{item.inventory_status_label || item.inventory_status || 'Unknown'}</span> },
                { key: 'suggested_action', label: 'Suggested action' },
                { key: 'expiration_date', label: 'Expiry', render: item => <>{item.expiration_date || 'N/A'}{item.days_until_expiry != null && <span className="block text-[10px] text-espresso/40">{item.days_until_expiry} day(s)</span>}</> },
                { key: 'storage_location', label: 'Storage', render: item => item.storage_location || 'N/A' },
              ]} rows={pagedIngredients} sort={sort} onSort={toggleSort} emptyIcon={Package} emptyTitle={loading ? 'Loading inventory' : 'No ingredients found'} emptyDescription={loading ? 'Inventory data is being refreshed.' : 'Try a different search or status filter.'} minWidth={980} containerClassName="h-full" emptyStateClassName="h-full !py-4" showEmptyTable />
            </div>
            <PaginationControls page={inventoryPage} setPage={setInventoryPage} total={visibleIngredients.length} pageSize={inventoryPageSize} alwaysVisible compact />
          </div>
        </section>
      ) : (
        <section role="tabpanel" id="admin-inventory-panel-product-sales" aria-labelledby="admin-inventory-tab-product-sales" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Card padding={false} className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 md:p-5">
            <CardHeader title="Today’s Product Sales, Returns & Wastage" subtitle="Serving counts reconcile to the beginning stock snapshot. A returned wasted drink remains consumed stock while its sale is removed from net sold and revenue." className="mb-3 shrink-0" />
            <div ref={salesAreaRef} className="min-h-0 flex-1">
              <DataTable columns={[
                { key: 'product_name', label: 'Product' },
                { key: 'beginning_stock', label: 'Beginning', align: 'right' },
                { key: 'quantity_sold', label: 'Sold', align: 'right', render: row => <button type="button" onClick={() => setSelectedActivity({ product: row, type: 'sales' })} aria-label={`View ${row.quantity_sold} sold transactions for ${row.product_name}`} className="rounded-lg px-2 py-1 font-black text-gold-dark underline decoration-gold/40 underline-offset-2 hover:bg-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{row.quantity_sold}</button> },
                { key: 'wastage', label: 'Wastage', align: 'right', render: row => <button type="button" onClick={() => setSelectedActivity({ product: row, type: 'wastage' })} aria-label={`View ${row.wastage} wastage records for ${row.product_name}`} className="rounded-lg px-2 py-1 font-black text-amber-800 underline decoration-amber-400/50 underline-offset-2 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{row.wastage}</button> },
                { key: 'ending_stock', label: 'Ending', align: 'right' },
                { key: 'revenue', label: 'Net revenue', align: 'right', render: row => formatCurrency(row.revenue) },
                { key: 'profit_loss', label: 'Profit / loss', align: 'right', render: row => <span className={Number(row.profit_loss) < 0 ? 'text-red-700' : 'text-emerald-700'}>{formatCurrency(row.profit_loss)}</span> },
              ]} rows={pagedSales} emptyIcon={Package} emptyTitle={loading ? 'Loading sales data' : 'No active products'} emptyDescription={loading ? 'Today’s product activity is being refreshed.' : 'Add café or studio products to track serving counts.'} minWidth={900} containerClassName="h-full" emptyStateClassName="h-full !py-4" showEmptyTable />
            </div>
            <PaginationControls page={salesPage} setPage={setSalesPage} total={productSalesInventory.length} pageSize={salesPageSize} alwaysVisible compact />
          </Card>
        </section>
      )}
      <ProductActivityModal
        product={selectedActivity?.product || null}
        activityType={selectedActivity?.type || 'sales'}
        reportDate={selectedActivity?.product?.date}
        onClose={() => setSelectedActivity(null)}
      />
    </div>
  );
}
