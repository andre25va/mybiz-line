import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSB() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const sb = getSB();
  const { data, error } = await sb
    .from('group_threads')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const sb = getSB();
  const { name, business, members } = await req.json();
  if (!name || !members?.length) {
    return NextResponse.json({ error: 'name and members required' }, { status: 400 });
  }
  const { data, error } = await sb
    .from('group_threads')
    .insert({ name, business: business || 'personal', members, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
