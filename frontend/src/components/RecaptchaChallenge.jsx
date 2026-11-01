import React, { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'google-recaptcha-v2-script';
let scriptPromise;

const loadRecaptcha = () => {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      let script = document.getElementById(SCRIPT_ID);
      const fail = () => reject(new Error('Google security check could not be loaded.'));
      if (script && !window.grecaptcha) {
        script.remove();
        script = null;
      }
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      const timeout = window.setTimeout(fail, 15000);
      window.grecaptcha?.ready?.(() => {
        window.clearTimeout(timeout);
        resolve(window.grecaptcha);
      });
      script.addEventListener('load', () => {
        window.grecaptcha?.ready?.(() => {
          window.clearTimeout(timeout);
          resolve(window.grecaptcha);
        });
      }, { once: true });
      script.addEventListener('error', () => {
        window.clearTimeout(timeout);
        script.remove();
        fail();
      }, { once: true });
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
};

export default function RecaptchaChallenge({ onTokenChange, resetKey = 0 }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY?.trim();

  useEffect(() => {
    let active = true;
    if (!siteKey || !containerRef.current) return undefined;
    setLoadError('');
    loadRecaptcha().then((grecaptcha) => {
      if (!active || !containerRef.current || widgetIdRef.current !== null) return;
      widgetIdRef.current = grecaptcha.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenChange(token, ''),
        'expired-callback': () => onTokenChange('', 'The security check expired. Complete it again to retry.'),
        'error-callback': () => onTokenChange('', 'The security check could not connect. Retry the check.'),
      });
    }).catch(() => {
      if (active) setLoadError('Google security check could not be loaded. Check your connection and retry.');
    });
    return () => { active = false; };
  }, [siteKey, attempt, onTokenChange]);

  useEffect(() => {
    if (widgetIdRef.current === null || !window.grecaptcha?.reset) return;
    window.grecaptcha.reset(widgetIdRef.current);
    onTokenChange('', '');
  }, [resetKey, onTokenChange]);

  if (!siteKey) {
    return <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800" role="alert">
      Security verification is not configured. Add REACT_APP_RECAPTCHA_SITE_KEY to the frontend environment.
    </div>;
  }

  return (
    <div className="space-y-2" aria-label="Security verification">
      <div ref={containerRef} className="min-h-[78px]" />
      {loadError && <div className="flex flex-wrap items-center gap-2 text-xs text-red-700" role="alert">
        <span>{loadError}</span>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className="font-bold underline">Retry check</button>
      </div>}
    </div>
  );
}
