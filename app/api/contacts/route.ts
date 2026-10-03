import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function sb(path: string, options?: RequestInit) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...((options?.headers as Record<string, string>) || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    console.error('Supabase error:', err);
    return null;
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export async function GET() {
  const data = await sb('/biz_contacts?order=name.asc');
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = await sb('/biz_contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(data || {});
}

export async function PATCH(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const body = await req.json();
  const data = await sb(`/biz_contacts?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return NextResponse.json(data || {});
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  await sb(`/biz_contacts?id=eq.${id}`, { method: 'DELETE' });
  return NextResponse.json({ ok: true });
}
