/**
 * US login numbers only. Contacts keep their own parser in lib/contact-phone.ts.
 * Returns E.164, or null when the number is not a valid NANP national number.
 */
export function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let national = '';
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits[0] === '1') national = digits.slice(1);
  else return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
  return `+1${national}`;
}
