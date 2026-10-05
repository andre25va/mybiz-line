export const ANDRE_CELL = '+13129989898';
export const MYBIZ_NUMBER = '+14647333257';

export function digitsOnly(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

/** US 10-digit national number, or null when it is not a US number. */
export function national10(phone: string | null | undefined): string | null {
  const d = digitsOnly(phone);
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return null;
}

export function toE164(phone: string | null | undefined): string | null {
  const n = national10(phone);
  if (n) return `+1${n}`;
  const d = digitsOnly(phone);
  if (d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

export function formatDisplay(phone: string | null | undefined): string {
  const n = national10(phone);
  if (n) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return toE164(phone) || (phone || '').trim();
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const da = national10(a) || digitsOnly(a);
  const db = national10(b) || digitsOnly(b);
  if (!da || !db) return false;
  return da === db;
}

export function parseAllowlist(raw: string | undefined): string[] {
  const value = raw && raw.trim() ? raw : ANDRE_CELL;
  return value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function isAllowlisted(from: string, allowlist: string[]): boolean {
  return allowlist.some((n) => samePhone(from, n));
}

export function isBlockedClientPhone(phone: string, blocked: string[]): boolean {
  return blocked.some((n) => samePhone(phone, n));
}
