export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 px-4 text-center ${className}`}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-espresso/5 flex items-center justify-center mb-3">
          <Icon className="w-7 h-7 text-espresso/40" />
        </div>
      )}
      <h3 className="heading-card mb-1 text-espresso">{title || 'Nothing here yet'}</h3>
      {description && <p className="text-sm leading-relaxed text-espresso/60 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
