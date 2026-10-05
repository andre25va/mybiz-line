import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/groups/[id]/messages
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await sb
    .from('group_messages')
    .select('*')
    .eq('group_id', params.id)
    .order('date_sent', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
