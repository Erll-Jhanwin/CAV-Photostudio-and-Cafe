import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Package, X } from 'lucide-react';
import client from '../../api/client';
import { Button } from '../ui/Button';
import { DataTable, PaginationControls, paginateRows } from '../ui/DataTable';
import { Modal } from '../ui/Modal';
import { LoadingSpinner } from '../ui/Skeleton';
import { formatManilaDateTime, getManilaDateInputValue } from '../../utils/dateTime';
import { calculateSalesRowsPerPage } from '../../pages/salesLogLayout';

const formatCurrency = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function ProductActivityModal({ product, activityType = 'sales', reportDate, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const tableAreaRef = useRef(null);
  const date = reportDate || getManilaDateInputValue();
  const isWastage = activityType === 'wastage';
  const visibleRecords = paginateRows(records, page, pageSize);

  useEffect(() => {
    if (!product?.product_id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setRecords([]);
    setPage(1);
    client.get('/api/inventory/product-sales/transactions/', {
      params: { product_id: product.product_id, date, type: activityType },
    }).then(response => {
      if (!cancelled) setRecords(Array.isArray(response.data) ? response.data : []);
    }).catch(() => {
      if (!cancelled) setError('Could not load these transaction records. Please close the window and try again.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [product?.product_id, date, activityType]);

  useLayoutEffect(() => {
    const area = tableAreaRef.current;
    if (!area) return undefined;
    const measure = () => {
      const table = area.querySelector('table');
      const headerHeight = table?.querySelector('thead')?.getBoundingClientRect().height || 0;
      const rowHeights = Array.from(table?.querySelectorAll('tbody tr') || []).map(row => row.getBoundingClientRect().height);
      const nextSize = calculateSalesRowsPerPage({ availableHeight: area.clientHeight, headerHeight, rowHeights, defaultRowHeight: 58 });
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
  }, [records, page, pageSize, loading, error]);

  useEffect(() => {
    setPage(current => Math.min(current, Math.max(1, Math.ceil(records.length / pageSize))));
  }, [records.length, pageSize]);

  const title = `${product?.product_name || product?.name || 'Product'} · ${isWastage ? 'Wastage' : 'Sales'} Records`;
  const columns = [
    { key: 'transaction_id', label: 'Transaction ID', width: 'w-[150px]' },
    { key: 'date_time', label: 'Date & time', width: 'w-[170px]', render: row => formatManilaDateTime(row.date_time) || 'Not recorded' },
    { key: 'quantity', label: 'Quantity', align: 'right', width: 'w-[90px]' },
    { key: 'staff_name', label: 'Staff', width: 'w-[145px]', render: row => row.staff_name || 'Not recorded' },
    ...(isWastage
      ? [{ key: 'reason', label: 'Reason', render: row => row.reason || 'Reason not recorded' }]
      : [{ key: 'sale_amount', label: 'Sale amount', align: 'right', width: 'w-[130px]', render: row => formatCurrency(row.sale_amount) }]),
  ];

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title={title}
      size="3xl"
      className="flex h-[calc(100dvh-2rem)] max-h-[42rem] min-h-0 flex-col overflow-hidden"
      bodyClassName="!max-h-none flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-5"
    >
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-espresso/[0.07] bg-cream/60 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-espresso">{product?.product_name || product?.name}</p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-espresso/45">{isWastage ? 'Wastage activity' : 'Completed sales'} · Reporting date {date}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${isWastage ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {records.length} record{records.length === 1 ? '' : 's'}
        </span>
      </div>

      {error ? (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-red-700" />
          <p className="text-sm font-bold text-red-800">{error}</p>
        </div>
      ) : (
        <>
          {loading && <div role="status" className="mb-2 flex shrink-0 items-center gap-2 text-xs font-bold text-espresso/60"><LoadingSpinner size="sm" className="text-gold-dark" label="Loading transaction records" />Loading transaction records…</div>}
          <div ref={tableAreaRef} className="min-h-0 flex-1">
            <DataTable
              columns={columns}
              rows={visibleRecords}
              emptyIcon={Package}
              emptyTitle={loading ? 'Loading records' : `No ${isWastage ? 'wastage' : 'sales'} records`}
              emptyDescription={loading ? 'Matching transactions are being loaded.' : `No ${isWastage ? 'wastage' : 'sales'} were recorded for this product on ${date}.`}
              minWidth={isWastage ? 720 : 680}
              containerClassName="h-full"
              emptyStateClassName="h-full !py-4"
              showEmptyTable
            />
          </div>
          <PaginationControls page={page} setPage={setPage} total={records.length} pageSize={pageSize} alwaysVisible compact className="shrink-0" />
        </>
      )}

      <div className="mt-3 flex shrink-0 justify-end border-t border-espresso/[0.06] pt-3">
        <Button variant="outline" size="sm" icon={X} onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
