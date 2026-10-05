import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/grok/notes?phone=... — get notes for a contact
// POST /api/grok/notes — create { phone, note, call_sid? }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 });

  const digits = phone.replace(/\D/g, '');
  const { data, error } = await supabase
    .from('call_notes')
    .select('*')
    .ilike('phone', `%${digits.slice(-10)}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data, count: data?.length ?? 0 });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { phone, note, call_sid } = body;
  if (!phone || !note) return NextResponse.json({ error: 'phone and note are required' }, { status: 400 });

  const { data, error } = await supabase.from('call_notes').insert({
    phone, note, call_sid, created_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, note: data });
}
