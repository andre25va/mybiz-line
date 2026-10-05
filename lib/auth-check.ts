import { NextRequest, NextResponse } from 'next/server';

/**
 * Returns a 401 response if the request is not authenticated.
 * Returns null if auth is valid (caller should continue).
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const cookie = req.cookies.get('mbl_auth')?.value;
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    // No password configured — block all access
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (cookie !== appPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
