import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function sbFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const res = await sbFetch(`/users?id=eq.${auth.userId}&select=ai_settings`);
  if (!res.ok) return NextResponse.json({ settings: null });
  const rows = await res.json();
  const settings = rows[0]?.ai_settings || null;
  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const { provider, api_key, model } = body;
  if (!provider || !api_key || !model) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const res = await sbFetch(`/users?id=eq.${auth.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ai_settings: { provider, api_key, model } }),
  });

  if (!res.ok) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
