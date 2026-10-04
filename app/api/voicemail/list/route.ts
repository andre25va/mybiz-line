import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from('voicemails')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// Mark as heard / delete
export async function POST(req: NextRequest) {
  const { id, action } = await req.json();
  if (action === 'heard') {
    await supabase.from('voicemails').update({ heard: true }).eq('id', id);
  } else if (action === 'delete') {
    await supabase.from('voicemails').delete().eq('id', id);
  }
  return NextResponse.json({ ok: true });
}
