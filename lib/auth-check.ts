import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from './session';

export type AuthResult = { userId: string };

/**
 * Returns { userId } if authenticated, or a NextResponse 401 if not.
 * Usage:
 *   const session = requireAuth(req);
 *   if (session instanceof NextResponse) return session;
 *   const { userId } = session;
 */
export function requireAuth(req: NextRequest): AuthResult | NextResponse {
  const token = req.cookies.get('mbl_session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = verifySession(token);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { userId };
}
