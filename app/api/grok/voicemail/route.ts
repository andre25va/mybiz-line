import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/grok/voicemail — list all voicemails
// GET /api/grok/voicemail?phone=... — voicemails from a number
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');

  let query = supabase.from('voicemails').select('*').order('created_at', { ascending: false });
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    query = query.ilike('from_number', `%${digits.slice(-10)}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voicemails: data, count: data?.length ?? 0 });
}
