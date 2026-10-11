export function LoadingSpinner({ size = 'md', className = '', label = 'Loading' }) {
  const sizeClass = size === 'lg' ? 'h-8 w-8' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';

  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`} role="status" aria-label={label}>
      <svg className={`${sizeClass} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={`skeleton-shimmer rounded-[18px] ${className || ''}`}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white/95 rounded-[24px] border border-espresso/[0.06] overflow-hidden shadow-[0_18px_45px_rgba(46,26,17,0.07)]">
      <Skeleton className="h-48 rounded-none" />
      <div className="p-5 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonTableRow({ cols = 6 }) {
  return (
    <tr className="border-b border-espresso/5">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="p-4">
          <Skeleton className={`h-4 ${i === 0 ? 'w-20' : i === cols - 1 ? 'w-16 ml-auto' : 'w-24'}`} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <div className="bg-white/95 rounded-[24px] border border-espresso/[0.06] overflow-hidden shadow-[0_18px_45px_rgba(46,26,17,0.07)]">
      <div className="bg-cream border-b border-espresso/[0.06] px-4 py-3">
        <div className="flex gap-6">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
      </div>
      <table className="w-full">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="bg-white/95 p-6 rounded-[24px] border border-espresso/[0.06] shadow-[0_18px_45px_rgba(46,26,17,0.07)] space-y-4">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

export function SkeletonStatsCard() {
  return (
    <div className="bg-white/95 p-5 rounded-[24px] border border-espresso/[0.06] shadow-[0_18px_45px_rgba(46,26,17,0.07)] flex items-center gap-4">
      <Skeleton className="w-12 h-12 rounded-2xl" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
      </div>
    </div>
  );
}

export function SkeletonProfileCard() {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 space-y-3">
      <Skeleton className="h-3 w-16 bg-white/10" />
      <Skeleton className="h-5 w-24 bg-white/10" />
      <div className="flex gap-4 pt-2 border-t border-white/5">
        <Skeleton className="h-3 w-16 bg-white/10" />
        <Skeleton className="h-3 w-16 bg-white/10" />
      </div>
    </div>
  );
}
