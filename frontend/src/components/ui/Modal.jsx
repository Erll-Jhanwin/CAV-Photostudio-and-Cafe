import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, className = '', bodyClassName = '', size = 'md' }) {
  const overlayRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlayRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const focusable = overlayRef.current?.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '5xl': 'max-w-5xl',
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-label={title ? undefined : 'Dialog'}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in"
    >
      <div className="absolute inset-0 bg-espresso-dark/55 backdrop-blur-xl" onClick={onClose} />
      <div className={`relative max-h-[calc(100dvh-2rem)] overflow-hidden bg-white rounded-[20px] border border-espresso/[0.08] shadow-[0_24px_64px_rgba(28,15,10,0.22)] w-full ${sizes[size] || sizes.md} animate-in-scale ${className}`}>
        {title && (
          <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-espresso/[0.06]">
            <h2 id="modal-title" className="heading-dialog text-espresso">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 rounded-full text-espresso/55 hover:text-espresso hover:bg-espresso/5 transition-all duration-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className={`p-4 sm:p-5 max-h-[calc(100dvh-7rem)] overflow-y-auto scrollbar-thin ${bodyClassName}`}>{children}</div>
      </div>
    </div>
  );
}
