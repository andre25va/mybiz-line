import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';

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
  if (!r.ok) {
    const err = await r.text();
    console.error('Supabase error:', err);
    throw new Error(err);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const data = await sb(`/biz_tasks?user_id=eq.${userId}&order=created_at.desc`);
    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const body = await req.json();
    const data = await sb('/biz_tasks', {
      method: 'POST',
      body: JSON.stringify({ ...body, user_id: userId, done: false }),
    });
    return NextResponse.json(data || {});
  } catch {
    return NextResponse.json({ error: 'Failed to save task' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const body = await req.json();
    const { id, ...rest } = body;
    const data = await sb(`/biz_tasks?id=eq.${id}&user_id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(rest),
    });
    return NextResponse.json(data || {});
  } catch {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    await sb(`/biz_tasks?id=eq.${id}&user_id=eq.${userId}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
