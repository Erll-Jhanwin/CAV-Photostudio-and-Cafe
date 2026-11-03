import React from 'react';

const formatCurrency = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ProductSalesLossSummary({ rows = [], startDate, endDate, onStartDateChange, onEndDateChange }) {
  const totalLoss = rows.reduce((total, row) => total + Number(row.loss || 0), 0);
  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-wide text-espresso/55">
          <span>From</span>
          <input aria-label="Product loss start date" type="date" value={startDate} max={endDate} onChange={event => onStartDateChange(event.target.value)} className="h-9 rounded-lg border border-espresso/15 bg-white px-2 text-xs font-bold normal-case text-espresso focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-wide text-espresso/55">
          <span>To</span>
          <input aria-label="Product loss end date" type="date" value={endDate} min={startDate} onChange={event => onEndDateChange(event.target.value)} className="h-9 rounded-lg border border-espresso/15 bg-white px-2 text-xs font-bold normal-case text-espresso focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </label>
      </div>
      <div className="text-right">
        <span className="block text-[10px] font-bold text-espresso/65">Wastage cost plus refunded sales</span>
        <span className="text-sm font-black tabular-nums text-red-800">Total loss {formatCurrency(totalLoss)}</span>
      </div>
    </div>
  );
}
