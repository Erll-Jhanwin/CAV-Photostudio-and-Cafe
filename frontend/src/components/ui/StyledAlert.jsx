import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Button } from './Button';

const StyledAlertContext = createContext(null);
const StyledConfirmContext = createContext(null);

const classifyAlert = (message) => {
  const text = String(message || '').toLowerCase();
  if (/(success|successfully|created|saved|updated|verified|submitted|complete)/.test(text)) {
    return 'success';
  }
  if (/(failed|invalid|cannot|error|out of stock|insufficient|exceed|required|wrong|unavailable)/.test(text)) {
    return 'error';
  }
  if (/(check|confirm|warning|no longer|already|please)/.test(text)) {
    return 'warning';
  }
  return 'info';
};

const alertStyles = {
  success: {
    title: 'Success',
    icon: CheckCircle2,
    iconClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accentClass: 'bg-emerald-500',
    buttonVariant: 'success',
  },
  error: {
    title: 'Action Needed',
    icon: XCircle,
    iconClass: 'bg-red-50 text-red-700 border-red-200',
    accentClass: 'bg-red-500',
    buttonVariant: 'danger',
  },
  warning: {
    title: 'Notice',
    icon: AlertTriangle,
    iconClass: 'bg-amber-50 text-amber-700 border-amber-200',
    accentClass: 'bg-amber-500',
    buttonVariant: 'gold',
  },
  info: {
    title: 'Message',
    icon: Info,
    iconClass: 'bg-blue-50 text-blue-700 border-blue-200',
    accentClass: 'bg-blue-500',
    buttonVariant: 'primary',
  },
};

export function StyledAlertProvider({ children }) {
  const [alerts, setAlerts] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationResolverRef = useRef(null);
  const currentAlert = alerts[0] || null;

  const showAlert = useMemo(() => (message, options = {}) => {
    const text = String(message ?? '');
    const type = options.type || classifyAlert(text);
    setAlerts(current => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message: text,
        type,
        title: options.title,
      },
    ]);
  }, []);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => showAlert(message);
    return () => {
      window.alert = originalAlert;
    };
  }, [showAlert]);

  const closeAlert = () => setAlerts(current => current.slice(1));

  const confirm = useMemo(() => (options = {}) => new Promise((resolve) => {
    confirmationResolverRef.current = resolve;
    setConfirmation({
      title: options.title || 'Confirm Action',
      message: options.message || 'Are you sure you want to continue?',
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      type: options.type || 'warning',
    });
  }), []);

  const closeConfirmation = (result) => {
    const resolver = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolver?.(result);
  };

  const meta = alertStyles[currentAlert?.type] || alertStyles.info;
  const Icon = meta.icon;
  const title = currentAlert?.title || meta.title;

  return (
    <StyledAlertContext.Provider value={showAlert}>
      <StyledConfirmContext.Provider value={confirm}>
      {children}
      {confirmation && (() => {
        const confirmMeta = alertStyles[confirmation.type] || alertStyles.warning;
        const ConfirmIcon = confirmMeta.icon;
        return (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="styled-confirm-title"
            aria-describedby="styled-confirm-message"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in"
          >
            <div className="absolute inset-0 bg-espresso-dark/55 backdrop-blur-md" onClick={() => closeConfirmation(false)} />
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_32px_90px_rgba(28,15,10,0.26)] animate-in-scale">
              <div className={`h-1.5 ${confirmMeta.accentClass}`} />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${confirmMeta.iconClass}`}>
                    <ConfirmIcon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id="styled-confirm-title" className="text-lg font-black text-espresso">
                      {confirmation.title}
                    </h2>
                    <p id="styled-confirm-message" className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-espresso/68">
                      {confirmation.message}
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Button variant="outline" size="sm" onClick={() => closeConfirmation(false)} autoFocus>
                    {confirmation.cancelLabel}
                  </Button>
                  <Button variant={confirmation.type === 'error' ? 'danger' : confirmMeta.buttonVariant} size="sm" onClick={() => closeConfirmation(true)}>
                    {confirmation.confirmLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {currentAlert && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="styled-alert-title"
          aria-describedby="styled-alert-message"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in"
        >
          <div className="absolute inset-0 bg-espresso-dark/55 backdrop-blur-md" onClick={closeAlert} />
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_32px_90px_rgba(28,15,10,0.26)] animate-in-scale">
            <div className={`h-1.5 ${meta.accentClass}`} />
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${meta.iconClass}`}>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="styled-alert-title" className="text-lg font-black text-espresso">
                    {title}
                  </h2>
                  <p id="styled-alert-message" className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-espresso/68">
                    {currentAlert.message}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button variant={meta.buttonVariant} size="sm" onClick={closeAlert} autoFocus>
                  OK
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      </StyledConfirmContext.Provider>
    </StyledAlertContext.Provider>
  );
}

export const useStyledAlert = () => useContext(StyledAlertContext);
export const useStyledConfirm = () => useContext(StyledConfirmContext);
