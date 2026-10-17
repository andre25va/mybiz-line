import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { sbOrNull as sb } from '@/lib/supabase-server';

// GET /api/grok/notes?phone=...
// POST /api/grok/notes — { phone, note, call_sid? }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 });

  const digits = phone.replace(/\D/g, '').slice(-10);
  const data = await sb(`/call_notes?phone=ilike.*${digits}*&order=created_at.desc&limit=50`);
  return NextResponse.json({ notes: data || [], count: (data || []).length });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { phone, note } = body;
  if (!phone || !note) return NextResponse.json({ error: 'phone and note are required' }, { status: 400 });

  const data = await sb('/call_notes', {
    method: 'POST',
    body: JSON.stringify({ ...body, created_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, note: data?.[0] || data });
}
