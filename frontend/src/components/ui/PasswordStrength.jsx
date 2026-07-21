import { CheckCircle2, XCircle } from 'lucide-react';
import { getPasswordStrength } from '../../utils/validation';

export function PasswordStrength({ password = '', className = '' }) {
  const strength = getPasswordStrength(password);
  const filledSegments = Math.max(1, Math.ceil((strength.passed / strength.total) * 4));

  return (
    <div className={`rounded-2xl border border-espresso/[0.08] bg-cream/70 p-3 text-xs ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-black text-espresso">Password strength</span>
        <span className={`font-black ${strength.isValid ? 'text-emerald-700' : 'text-espresso/55'}`}>
          {password ? strength.label : 'Required'}
        </span>
      </div>
      <div className="mb-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map(index => (
          <span
            key={index}
            className={`h-1.5 rounded-full ${password && index < filledSegments ? strength.color : 'bg-espresso/10'}`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {strength.checks.map(check => (
          <div
            key={check.key}
            className={`flex items-center gap-2 font-semibold ${check.valid ? 'text-emerald-700' : 'text-espresso/48'}`}
          >
            {check.valid ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
            <span>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
