export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-espresso/5 flex items-center justify-center mb-4">
          <Icon className="w-8 h-8 text-espresso/20" />
        </div>
      )}
      <h4 className="text-sm font-bold text-espresso/50 mb-1">{title || 'Nothing here yet'}</h4>
      {description && <p className="text-xs text-espresso/35 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
