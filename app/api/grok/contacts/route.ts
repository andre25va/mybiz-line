import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';

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
  if (!r.ok) { const err = await r.text(); console.error('Supabase error:', err); return null; }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// GET /api/grok/contacts?phone=... or ?name=... or ?q=...
// POST /api/grok/contacts — create { name, phone, email?, business?, tags?, notes?, address? }
// PATCH /api/grok/contacts — update { phone (lookup key), ...fields }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  const name = searchParams.get('name');
  const q = searchParams.get('q');

  let filter = '';
  if (phone) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    filter = `?phone=ilike.*${digits}*&order=name.asc`;
  } else if (name) {
    filter = `?name=ilike.*${encodeURIComponent(name)}*&order=name.asc`;
  } else if (q) {
    filter = `?or=(name.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*)&order=name.asc`;
  } else {
    filter = '?order=name.asc&limit=100';
  }

  const data = await sb(`/biz_contacts${filter}`);
  return NextResponse.json({ contacts: data || [], count: (data || []).length });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { name, phone } = body;
  if (!name || !phone) return NextResponse.json({ error: 'name and phone are required' }, { status: 400 });

  const data = await sb('/biz_contacts', {
    method: 'POST',
    body: JSON.stringify({ ...body, business: body.business ?? 'personal', created_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, contact: data?.[0] || data });
}

export async function PATCH(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { phone, ...updates } = body;
  if (!phone) return NextResponse.json({ error: 'phone is required to identify contact' }, { status: 400 });

  const digits = phone.replace(/\D/g, '').slice(-10);
  const data = await sb(`/biz_contacts?phone=ilike.*${digits}*`, {
    method: 'PATCH',
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, contact: data?.[0] || data });
}
