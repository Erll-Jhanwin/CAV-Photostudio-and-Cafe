const statusStyles = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CASH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  GCASH: 'bg-blue-50 text-blue-700 border-blue-200',
  CARD: 'bg-purple-50 text-purple-700 border-purple-200',
  ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
  STAFF: 'bg-blue-50 text-blue-700 border-blue-200',
  CUSTOMER: 'bg-gray-50 text-gray-700 border-gray-200',
  WALK_IN: 'bg-amber-50 text-amber-700 border-amber-200',
  BOOKING_LINKED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export function Badge({ children, variant, className = '' }) {
  const style = statusStyles[children] || statusStyles[variant] || 'bg-gray-50 text-gray-700 border-gray-200';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${style} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  return <Badge>{status || 'UNKNOWN'}</Badge>;
}
