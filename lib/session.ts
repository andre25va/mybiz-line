import { createHmac } from 'crypto';

const SECRET = process.env.SESSION_SECRET!;

/** Sign a userId into a tamper-proof session token */
export function signSession(userId: string): string {
  if (!SECRET) throw new Error('SESSION_SECRET not configured');
  const sig = createHmac('sha256', SECRET).update(userId).digest('hex');
  return `${userId}.${sig}`;
}

/** Verify a session token and return the userId, or null if invalid */
export function verifySession(token: string): string | null {
  if (!SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(userId).digest('hex');
  // constant-time compare
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}
