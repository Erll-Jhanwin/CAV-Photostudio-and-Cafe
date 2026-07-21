export const COMMON_WEAK_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'admin123',
  'admin123!',
  'cav12345',
  'letmein',
  'password',
  'password1',
  'password12',
  'password123',
  'password123!',
  'qwerty',
  'qwerty123',
  'welcome',
  'welcome123',
]);

export const isBlank = (value) => !String(value ?? '').trim();

export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export const isValidPhone = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return true;
  return /^\+?[\d\s().-]{7,20}$/.test(raw) && raw.replace(/\D/g, '').length >= 7;
};

export const getRequiredError = (value, label) => (isBlank(value) ? `${label} is required.` : '');

export const getEmailError = (value, { required = false, label = 'Email' } = {}) => {
  if (isBlank(value)) return required ? `${label} is required.` : '';
  return isValidEmail(value) ? '' : 'Enter a valid email address.';
};

export const getPhoneError = (value) => {
  if (isBlank(value)) return '';
  return isValidPhone(value) ? '' : 'Enter a valid phone number.';
};

export const getPasswordChecks = (password = '') => {
  const normalized = String(password).trim().toLowerCase();
  return [
    { key: 'length', label: 'At least 8 characters', valid: password.length >= 8 },
    { key: 'uppercase', label: 'One uppercase letter', valid: /[A-Z]/.test(password) },
    { key: 'lowercase', label: 'One lowercase letter', valid: /[a-z]/.test(password) },
    { key: 'number', label: 'One number', valid: /\d/.test(password) },
    { key: 'special', label: 'One special character', valid: /[^A-Za-z0-9\s]/.test(password) },
    { key: 'common', label: 'Not a common password', valid: !!password && !COMMON_WEAK_PASSWORDS.has(normalized) },
  ];
};

export const getPasswordStrength = (password = '') => {
  const checks = getPasswordChecks(password);
  const passed = checks.filter(check => check.valid).length;
  const isValid = checks.every(check => check.valid);
  let label = 'Very weak';
  let color = 'bg-red-500';

  if (isValid) {
    label = 'Strong';
    color = 'bg-emerald-500';
  } else if (passed >= 4) {
    label = 'Good';
    color = 'bg-gold';
  } else if (passed >= 3) {
    label = 'Fair';
    color = 'bg-amber-500';
  } else if (passed >= 1) {
    label = 'Weak';
    color = 'bg-red-500';
  }

  return { checks, passed, total: checks.length, isValid, label, color };
};

export const getPasswordError = (password, label = 'Password') => {
  if (isBlank(password)) return `${label} is required.`;
  const strength = getPasswordStrength(password);
  return strength.isValid ? '' : `${label} does not meet the password requirements.`;
};

export const getConfirmPasswordError = (password, confirmation) => {
  if (isBlank(confirmation)) return 'Confirm password is required.';
  return password === confirmation ? '' : 'Passwords do not match.';
};
