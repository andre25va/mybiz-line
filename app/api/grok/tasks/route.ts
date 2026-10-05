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

// GET /api/grok/tasks?phone=... or all
// POST /api/grok/tasks — { title, phone?, due_date?, notes?, priority? }
// PATCH /api/grok/tasks — { id, ...fields }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');

  let filter = '?order=due_date.asc&limit=100';
  if (phone) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    filter = `?phone=ilike.*${digits}*&order=due_date.asc`;
  }

  const data = await sb(`/biz_tasks${filter}`);
  return NextResponse.json({ tasks: data || [], count: (data || []).length });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  if (!body.title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const data = await sb('/biz_tasks', {
    method: 'POST',
    body: JSON.stringify({ ...body, status: 'pending', priority: body.priority ?? 'normal', created_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, task: data?.[0] || data });
}

export async function PATCH(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const data = await sb(`/biz_tasks?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, task: data?.[0] || data });
}
