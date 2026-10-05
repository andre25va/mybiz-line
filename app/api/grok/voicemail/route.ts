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

// GET /api/grok/voicemail — all voicemails
// GET /api/grok/voicemail?phone=... — for a specific number
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');

  let filter = '?order=created_at.desc&limit=50';
  if (phone) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    filter = `?from_number=ilike.*${digits}*&order=created_at.desc&limit=50`;
  }

  const data = await sb(`/voicemails${filter}`);
  return NextResponse.json({ voicemails: data || [], count: (data || []).length });
}
