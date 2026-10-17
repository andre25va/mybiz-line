import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

function getSB() {
  return getSupabase();
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sb = getSB();
  const { data, error } = await sb
    .from('group_messages')
    .select('*')
    .eq('group_id', id)
    .order('date_sent', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
