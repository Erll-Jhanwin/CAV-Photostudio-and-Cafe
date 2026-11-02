export function Card({ children, className = '', padding = true, hover = false, ...props }) {
  return (
    <div
      className={`
        bg-white/95 rounded-2xl border border-espresso/[0.06] shadow-[0_12px_32px_rgba(46,26,17,0.06)]
        ${hover ? 'hover:shadow-[0_18px_42px_rgba(46,26,17,0.10)] hover:-translate-y-0.5 transition-all duration-200 ease-out' : ''}
        ${padding ? 'p-4 sm:p-5' : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className = '', headingLevel = 2 }) {
  const Heading = `h${Math.min(6, Math.max(1, Math.floor(Number(headingLevel) || 2)))}`;
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3 ${className}`}>
      <div className="space-y-1">
        <Heading className="heading-section text-espresso">{title}</Heading>
        {subtitle && <p className="text-sm leading-relaxed text-espresso/65">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardSection({ title, children, className = '' }) {
  return (
    <div className={`space-y-4 ${className}`}>
      {title && (
        <h3 className="heading-card text-espresso/75">{title}</h3>
      )}
      {children}
    </div>
  );
}
