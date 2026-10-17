import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { sbOrNull as sb } from '@/lib/supabase-server';

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
