import { forwardRef } from 'react';

export const Input = forwardRef(({ label, icon: Icon, suffix, error, className = '', ...props }, ref) => {
  const id = props.id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;
  const isDarkField = className.includes('text-white') || className.includes('bg-white/[');
  const labelClass = isDarkField ? 'text-cream/85' : 'text-espresso/70';
  const iconClass = isDarkField ? 'text-cream/45' : 'text-espresso/40';

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className={`text-xs font-bold uppercase tracking-[0.16em] block ${labelClass}`}>
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className={`absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none ${iconClass}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          ref={ref}
          id={id}
          className={`
            w-full bg-white/90 border rounded-xl px-4 py-3 text-sm text-espresso shadow-[0_10px_26px_rgba(46,26,17,0.04)]
            placeholder:text-espresso/40
            transition-all duration-300 ease-out
            focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 focus:bg-white
            disabled:opacity-50 disabled:cursor-not-allowed
            ${Icon ? 'pl-10' : ''}
            ${suffix ? 'pr-10' : ''}
            ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-espresso/10'}
            ${className}
          `}
          {...props}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
            {suffix}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 font-medium mt-1">{error}</p>}
    </div>
  );
});

export const Select = forwardRef(({ label, icon: Icon, error, options = [], className = '', ...props }, ref) => {
  const id = props.id || `select-${label?.toLowerCase().replace(/\s+/g, '-')}`;
  const isDarkField = className.includes('text-white') || className.includes('bg-white/[');
  const labelClass = isDarkField ? 'text-cream/85' : 'text-espresso/70';
  const iconClass = isDarkField ? 'text-cream/45' : 'text-espresso/40';

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className={`text-xs font-bold uppercase tracking-[0.16em] block ${labelClass}`}>
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className={`absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none ${iconClass}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <select
          ref={ref}
          id={id}
          className={`
            w-full bg-white/90 border rounded-xl px-4 py-3 text-sm text-espresso shadow-[0_10px_26px_rgba(46,26,17,0.04)]
            transition-all duration-300 ease-out
            focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 focus:bg-white
            disabled:opacity-50 disabled:cursor-not-allowed
            ${Icon ? 'pl-10' : ''}
            ${error ? 'border-red-400' : 'border-espresso/10'}
            ${className}
          `}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value || opt} value={opt.value || opt}>
              {opt.label || opt}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-[11px] text-red-500 font-medium mt-1">{error}</p>}
    </div>
  );
});

export const Textarea = forwardRef(({ label, error, className = '', ...props }, ref) => {
  const id = props.id || `textarea-${label?.toLowerCase().replace(/\s+/g, '-')}`;
  const isDarkField = className.includes('text-white') || className.includes('bg-white/[');
  const labelClass = isDarkField ? 'text-cream/85' : 'text-espresso/70';

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className={`text-xs font-bold uppercase tracking-[0.16em] block ${labelClass}`}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        className={`
          w-full bg-white/90 border rounded-xl px-4 py-3 text-sm text-espresso
          placeholder:text-espresso/40 resize-none shadow-[0_10px_26px_rgba(46,26,17,0.04)]
          transition-all duration-300 ease-out
          focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/15 focus:bg-white
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-400' : 'border-espresso/10'}
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-[11px] text-red-500 font-medium mt-1">{error}</p>}
    </div>
  );
});
