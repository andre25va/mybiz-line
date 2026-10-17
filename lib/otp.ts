import 'server-only';
import { createHmac, randomInt } from 'node:crypto';

/** Optional. When unset, login codes are hashed with SESSION_SECRET. */
export function loginCodePepper(): string | undefined {
  const pepper = process.env.OTP_PEPPER || process.env.SESSION_SECRET;
  return pepper ? pepper : undefined;
}

export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashLoginCode(phone: string, code: string): string {
  const pepper = loginCodePepper();
  if (!pepper) throw new Error('missing_pepper');
  return createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
}
