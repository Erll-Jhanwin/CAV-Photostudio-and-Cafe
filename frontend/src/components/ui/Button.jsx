import { useState } from 'react';

const variants = {
  primary: 'bg-espresso text-cream shadow-[0_14px_34px_rgba(46,26,17,0.18)] hover:bg-espresso-light hover:shadow-[0_18px_42px_rgba(46,26,17,0.24)] active:bg-espresso-dark',
  gold: 'bg-gold text-espresso shadow-[0_14px_34px_rgba(212,175,55,0.22)] hover:bg-gold-light hover:shadow-[0_18px_42px_rgba(212,175,55,0.30)] active:bg-gold-dark',
  outline: 'bg-white/70 border border-espresso/10 text-espresso shadow-[0_10px_24px_rgba(46,26,17,0.06)] hover:bg-cream-dark hover:border-espresso/20 hover:shadow-[0_14px_30px_rgba(46,26,17,0.10)] active:bg-cream',
  ghost: 'text-espresso/75 hover:text-espresso hover:bg-espresso/5 active:bg-espresso/10',
  danger: 'bg-red-600 text-white shadow-[0_14px_34px_rgba(220,38,38,0.18)] hover:bg-red-700 hover:shadow-[0_18px_42px_rgba(220,38,38,0.24)] active:bg-red-800',
  success: 'bg-green-700 text-white shadow-[0_14px_34px_rgba(21,128,61,0.18)] hover:bg-green-800 hover:shadow-[0_18px_42px_rgba(21,128,61,0.24)] active:bg-green-900',
};

const sizes = {
  xs: 'px-2.5 py-1.5 text-[10px]',
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-sm',
  xl: 'px-8 py-4 text-base',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon,
  className = '',
  type = 'button',
  onClick,
  ...props
}) {
  const [ripple, setRipple] = useState(null);

  const handleClick = (e) => {
    if (loading || disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top, id: Date.now() });
    setTimeout(() => setRipple(null), 600);
    onClick?.(e);
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
      className={`
        relative inline-flex min-h-9 items-center justify-center gap-2 rounded-xl font-bold
        transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
        disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100
        focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold
        overflow-hidden
        ${variants[variant] || variants.primary}
        ${sizes[size] || sizes.md}
        ${className}
      `}
      onClick={handleClick}
    >
      {ripple && (
        <span
          className="absolute w-4 h-4 bg-white/20 rounded-full pointer-events-none animate-in-scale"
          style={{ left: ripple.x - 8, top: ripple.y - 8 }}
        />
      )}
      {loading ? (
        <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : Icon ? (
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, variant = 'ghost', size = 'md', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      {...props}
      className={`
        inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-95
        focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold
        ${variants[variant] || variants.ghost}
        ${size === 'sm' ? 'p-1.5' : size === 'lg' ? 'p-3' : 'p-2'}
        ${className}
      `}
    >
      {typeof icon === 'function' ? icon({ className: 'w-4 h-4' }) : icon}
    </button>
  );
}
