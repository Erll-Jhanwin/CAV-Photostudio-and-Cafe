import { useState } from 'react';

const variants = {
  primary: 'bg-espresso text-cream hover:bg-espresso-light shadow-[0_14px_34px_rgba(46,26,17,0.18)]',
  gold: 'bg-gold text-espresso hover:bg-gold-light shadow-[0_14px_34px_rgba(212,175,55,0.22)]',
  outline: 'bg-white/70 border border-espresso/10 text-espresso hover:bg-cream-dark hover:border-espresso/20 shadow-[0_10px_24px_rgba(46,26,17,0.06)]',
  ghost: 'text-espresso/75 hover:text-espresso hover:bg-espresso/5',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-[0_14px_34px_rgba(220,38,38,0.18)]',
  success: 'bg-green-700 text-white hover:bg-green-800 shadow-[0_14px_34px_rgba(21,128,61,0.18)]',
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
  ...props
}) {
  const [ripple, setRipple] = useState(null);

  const handleClick = (e) => {
    if (loading || disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top, id: Date.now() });
    setTimeout(() => setRipple(null), 600);
    props.onClick?.(e);
  };

  return (
    <button
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center gap-2 font-bold rounded-[20px]
        transition-all duration-300 ease-out active:scale-[0.98] hover:-translate-y-0.5
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold
        overflow-hidden
        ${variants[variant] || variants.primary}
        ${sizes[size] || sizes.md}
        ${className}
      `}
      onClick={handleClick}
      {...props}
    >
      {ripple && (
        <span
          className="absolute w-4 h-4 bg-white/20 rounded-full pointer-events-none animate-in-scale"
          style={{ left: ripple.x - 8, top: ripple.y - 8 }}
        />
      )}
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : Icon ? (
        <Icon className="w-4 h-4" />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, variant = 'ghost', size = 'md', className = '', ...props }) {
  return (
    <button
      aria-label={label}
      className={`
        inline-flex items-center justify-center rounded-[18px] transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-95
        focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold
        ${variants[variant] || variants.ghost}
        ${size === 'sm' ? 'p-1.5' : size === 'lg' ? 'p-3' : 'p-2'}
        ${className}
      `}
      {...props}
    >
      {typeof icon === 'function' ? icon({ className: 'w-4 h-4' }) : icon}
    </button>
  );
}
