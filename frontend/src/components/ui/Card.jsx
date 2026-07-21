export function Card({ children, className = '', padding = true, hover = false, ...props }) {
  return (
    <div
      className={`
        bg-white/95 rounded-2xl border border-espresso/[0.06] shadow-[0_18px_45px_rgba(46,26,17,0.07)]
        ${hover ? 'hover:shadow-[0_26px_60px_rgba(46,26,17,0.11)] hover:-translate-y-1 transition-all duration-300 ease-out' : ''}
        ${padding ? 'p-6 md:p-7' : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 ${className}`}>
      <div className="space-y-1.5">
        <h3 className="font-sans text-lg md:text-xl font-extrabold tracking-tight text-espresso">{title}</h3>
        {subtitle && <p className="text-sm leading-relaxed text-espresso/65">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardSection({ title, children, className = '' }) {
  return (
    <div className={`space-y-5 ${className}`}>
      {title && (
        <h4 className="text-xs font-bold text-espresso/60 uppercase tracking-[0.16em]">{title}</h4>
      )}
      {children}
    </div>
  );
}
