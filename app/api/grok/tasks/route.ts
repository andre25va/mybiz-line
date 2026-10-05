import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/grok/tasks?phone=... or all tasks
// POST /api/grok/tasks — create { title, phone?, due_date?, notes?, priority? }
// PATCH /api/grok/tasks — update { id, ...fields } (no delete)
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');

  let query = supabase.from('biz_tasks').select('*').order('due_date', { ascending: true });
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    query = query.ilike('phone', `%${digits.slice(-10)}%`);
  }

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data, count: data?.length ?? 0 });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { title, phone, due_date, notes, priority } = body;
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const { data, error } = await supabase.from('biz_tasks').insert({
    title, phone, due_date, notes, priority: priority ?? 'normal',
    status: 'pending', created_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, task: data });
}

export async function PATCH(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('biz_tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, task: data });
}
