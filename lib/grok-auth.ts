import { NextRequest, NextResponse } from 'next/server';

export function validateGrokKey(req: NextRequest): NextResponse | null {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.MYBIZ_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // valid
}
