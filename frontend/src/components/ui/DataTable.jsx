import { BarChart2, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { EmptyState } from './EmptyState';

const normalizeColumn = (column) => {
  if (Array.isArray(column)) {
    return { key: column[0], label: column[1] };
  }
  return column;
};

const getValue = (row, key) => {
  if (!key) return '';
  return String(key).split('.').reduce((value, part) => value?.[part], row);
};

export const sortRows = (rows, sort) => {
  if (!sort?.key) return [...(rows || [])];

  return [...(rows || [])].sort((a, b) => {
    const rawA = sort.accessor ? sort.accessor(a) : getValue(a, sort.key);
    const rawB = sort.accessor ? sort.accessor(b) : getValue(b, sort.key);
    const av = rawA ?? '';
    const bv = rawB ?? '';
    const aNumber = Number(av);
    const bNumber = Number(bv);
    const bothNumeric = av !== '' && bv !== '' && !Number.isNaN(aNumber) && !Number.isNaN(bNumber);

    if (bothNumeric) {
      return sort.dir === 'asc' ? aNumber - bNumber : bNumber - aNumber;
    }

    const result = String(av).localeCompare(String(bv), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return sort.dir === 'asc' ? result : -result;
  });
};

export const paginateRows = (rows, page, pageSize) => {
  const source = rows || [];
  const pages = Math.max(Math.ceil(source.length / pageSize), 1);
  const safePage = Math.min(Math.max(page, 1), pages);
  return source.slice((safePage - 1) * pageSize, safePage * pageSize);
};

export function PaginationControls({
  page,
  setPage,
  total,
  pageSize,
  setPageSize,
  pageSizeOptions = [5, 10, 25, 50],
}) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (pages <= 1 && !setPageSize) return null;

  const safePage = Math.min(Math.max(page, 1), pages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  const firstPage = Math.max(1, Math.min(safePage - 2, pages - 4));
  const visiblePages = Array.from({ length: Math.min(5, pages) }, (_, i) => firstPage + i).filter(value => value <= pages);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-espresso/[0.06] pt-3 text-xs text-espresso/60 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-espresso/70">
          Showing {start}-{end} of {total}
        </span>
        {setPageSize && (
          <label className="inline-flex items-center gap-2 rounded-xl bg-cream/70 px-2.5 py-1.5 font-bold">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-transparent text-espresso focus:outline-none"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-cream disabled:opacity-40 hover:bg-cream-dark transition-colors" aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {visiblePages.map(pageNumber => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => setPage(pageNumber)}
            className={`h-8 min-w-8 rounded-xl px-2 font-black transition-colors ${
              pageNumber === safePage ? 'bg-espresso text-gold' : 'bg-cream text-espresso/65 hover:bg-cream-dark hover:text-espresso'
            }`}
            aria-current={pageNumber === safePage ? 'page' : undefined}
          >
            {pageNumber}
          </button>
        ))}
        <button type="button" disabled={safePage >= pages} onClick={() => setPage(Math.min(pages, safePage + 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-cream disabled:opacity-40 hover:bg-cream-dark transition-colors" aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  sort,
  onSort,
  renderCell,
  renderActions,
  actionLabel = 'Actions',
  emptyIcon = BarChart2,
  emptyTitle = 'No records found',
  emptyDescription = 'No data matches the current filters.',
  minWidth = 760,
  actionWidth = 'w-[132px]',
}) {
  const normalizedColumns = columns.map(normalizeColumn);

  if (!rows?.length) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  const handleSort = (column) => {
    if (!onSort || column.sortable === false) return;
    onSort(column.key, column);
  };

  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-espresso/[0.06] bg-white/80 scrollbar-thin">
      <table className="w-full table-fixed text-xs" style={{ minWidth }}>
        <thead className="sticky top-0 z-10 bg-cream">
          <tr className="border-b border-espresso/[0.08] text-espresso/55 uppercase tracking-wider">
            {normalizedColumns.map((column, index) => {
              const active = sort?.key === column.key;
              const SortIcon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
              const alignClass = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
              return (
                <th
                  key={column.key}
                  className={`${index === 0 ? 'w-[26%]' : ''} px-4 py-3 align-bottom ${alignClass} ${column.width || ''}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {onSort && column.sortable !== false ? (
                    <button type="button" onClick={() => handleSort(column)} className={`inline-flex max-w-full items-center gap-1.5 whitespace-normal break-words font-black leading-snug hover:text-espresso focus-visible:outline-gold ${column.align === 'right' ? 'justify-end text-right' : column.align === 'center' ? 'justify-center text-center' : 'text-left'}`}>
                      <span>{column.label}</span>
                      <SortIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="font-black leading-snug">{column.label}</span>
                  )}
                </th>
              );
            })}
            {renderActions && (
              <th className={`${actionWidth} px-4 py-3 text-right align-bottom`}>
                <span className="font-black leading-snug">{actionLabel}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-espresso/[0.04] hover:bg-cream/45 transition-colors">
              {normalizedColumns.map((column, index) => {
                const alignClass = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
                return (
                  <td key={column.key} className={`${index === 0 ? 'font-bold text-espresso' : 'font-semibold text-espresso/75'} px-4 py-3.5 align-middle leading-relaxed whitespace-normal break-words ${alignClass}`}>
                    <div className="min-w-0 max-w-full">
                      {column.render ? column.render(row) : renderCell ? renderCell(row, column.key) : getValue(row, column.key)}
                    </div>
                  </td>
                );
              })}
              {renderActions && (
                <td className="px-4 py-3.5 text-right align-middle">
                  <div className="flex justify-end gap-1.5">
                    {renderActions(row)}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
