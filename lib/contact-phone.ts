import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Convert a valid US number or an explicitly international E.164 number to
 * canonical E.164. Unprefixed non-US or ambiguous values are rejected.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || !/^\+?[0-9().\s-]+$/.test(raw) || (raw.match(/\+/g) || []).length > 1) return null;

  const digits = raw.replace(/\D/g, '');
  const explicitInternational = raw.startsWith('+');
  let parsed;

  if (explicitInternational) {
    parsed = parsePhoneNumberFromString(raw);
  } else if (digits.length === 10) {
    parsed = parsePhoneNumberFromString(raw, 'US');
  } else if (digits.length === 11 && digits.startsWith('1')) {
    parsed = parsePhoneNumberFromString('+' + digits);
  } else {
    return null;
  }

  if (!parsed || !parsed.isValid() || parsed.ext) return null;
  if (!explicitInternational && parsed.country !== 'US') return null;
  return parsed.number;
}

export type PhoneContact = { phone: unknown };

/** Duplicate canonical numbers are kept ambiguous instead of picking a winner silently. */
export function buildUniquePhoneMap<T extends PhoneContact>(contacts: readonly T[]): Map<string, T | null> {
  const map = new Map<string, T | null>();
  for (const contact of contacts) {
    const key = normalizePhone(contact.phone);
    if (!key) continue;
    if (map.has(key)) map.set(key, null);
    else map.set(key, contact);
  }
  return map;
}

export function matchPhone<T extends PhoneContact>(map: ReadonlyMap<string, T | null>, phone: unknown): T | null {
  const key = normalizePhone(phone);
  return key ? map.get(key) ?? null : null;
}
