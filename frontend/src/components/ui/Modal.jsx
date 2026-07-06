import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, className = '', size = 'md' }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      const handleEsc = (e) => { if (e.key === 'Escape') onClose?.(); };
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleEsc);
      };
    }
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const focusable = overlayRef.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in"
    >
      <div className="absolute inset-0 bg-espresso-dark/55 backdrop-blur-xl" onClick={onClose} />
      <div className={`relative bg-white/95 rounded-[24px] border border-white/70 shadow-[0_32px_90px_rgba(28,15,10,0.26)] w-full ${sizes[size] || sizes.md} animate-in-scale ${className}`}>
        {title && (
          <div className="flex items-center justify-between p-6 md:p-7 border-b border-espresso/[0.06]">
            <h3 className="font-sans text-xl md:text-2xl font-extrabold tracking-tight text-espresso">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 rounded-full text-espresso/55 hover:text-espresso hover:bg-espresso/5 transition-all duration-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="p-6 md:p-7">{children}</div>
      </div>
    </div>
  );
}
