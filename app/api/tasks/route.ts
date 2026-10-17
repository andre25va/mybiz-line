import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb } from '@/lib/supabase-server';

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
