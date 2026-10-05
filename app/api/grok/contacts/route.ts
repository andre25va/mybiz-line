import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/grok/contacts?phone=... or ?name=... or ?q=... — search/lookup
// POST /api/grok/contacts — create contact { name, phone, email?, business?, tags?, notes?, address? }
// PATCH /api/grok/contacts — update contact { phone (lookup key), ...fields }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  const name = searchParams.get('name');
  const q = searchParams.get('q');

  let query = supabase.from('biz_contacts').select('*');

  if (phone) {
    const digits = phone.replace(/\D/g, '');
    query = query.ilike('phone', `%${digits.slice(-10)}%`);
  } else if (name) {
    query = query.ilike('name', `%${name}%`);
  } else if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query.order('name').limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data, count: data?.length ?? 0 });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { name, phone, email, business, tags, notes, address } = body;
  if (!name || !phone) return NextResponse.json({ error: 'name and phone are required' }, { status: 400 });

  const { data, error } = await supabase.from('biz_contacts').insert({
    name, phone, email, business: business ?? 'personal', tags, notes, address,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, contact: data });
}

export async function PATCH(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { phone, ...updates } = body;
  if (!phone) return NextResponse.json({ error: 'phone is required to identify contact' }, { status: 400 });

  const digits = phone.replace(/\D/g, '');
  const { data, error } = await supabase
    .from('biz_contacts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .ilike('phone', `%${digits.slice(-10)}%`)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, contact: data });
}
