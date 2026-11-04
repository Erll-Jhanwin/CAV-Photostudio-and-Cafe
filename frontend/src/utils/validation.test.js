import {
  getEmailError,
  getPhilippineMobileError,
  getPhoneError,
  isValidEmail,
  isValidPhilippineMobile,
} from './validation';

describe('Philippine mobile validation', () => {
  test('accepts exactly 11 digits beginning with 09', () => {
    expect(isValidPhilippineMobile('09876543122')).toBe(true);
    expect(getPhilippineMobileError('09876543122')).toBe('');
  });

  test.each([
    '',
    '0987654312',
    '098765431222',
    '+639876543122',
    '098-7654-3122',
    '098 7654 3122',
    ' 09876543122',
    '09876543122 ',
    '09876543abc',
    '11876543122',
  ])('rejects invalid mobile input %p', value => {
    expect(isValidPhilippineMobile(value)).toBe(false);
    expect(getPhilippineMobileError(value)).not.toBe('');
  });

  test('optional phone fields still reject malformed nonblank values', () => {
    expect(getPhoneError('')).toBe('');
    expect(getPhoneError('09876543122')).toBe('');
    expect(getPhoneError('0917 123 4567')).not.toBe('');
  });
});

describe('email validation', () => {
  test('trims surrounding spaces and accepts valid email addresses', () => {
    expect(isValidEmail('  person@example.com  ')).toBe(true);
    expect(getEmailError('  person@example.com  ', { required: true })).toBe('');
  });

  test.each(['', 'person@localhost', 'person@@example.com', 'person@example..com', 'person name@example.com'])('rejects invalid email input %p', value => {
    expect(isValidEmail(value)).toBe(false);
    expect(getEmailError(value, { required: true })).not.toBe('');
  });

  test('enforces the backend email length limit without truncating the value', () => {
    const tooLong = `${'a'.repeat(245)}@example.com`;
    expect(getEmailError(tooLong)).toBe('Email must be 254 characters or fewer.');
  });
});
