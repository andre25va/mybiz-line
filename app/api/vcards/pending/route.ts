import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb } from '@/lib/sb-rest';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const res = await sb(`/pending_vcards?user_id=eq.${userId}&status=eq.pending&select=id,name,phone,email,from_number,received_at`, { method: 'GET' });
  const rows = await res.json();
  return NextResponse.json(rows);
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const { id, action, contactData } = await req.json();
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });

  if (action === 'dismiss') {
    await sb(`/pending_vcards?id=eq.${id}&user_id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'save') {
    // Save to biz_contacts
    await sb('/biz_contacts', {
      method: 'POST',
      body: JSON.stringify({ ...contactData, user_id: userId }),
    });
    await sb(`/pending_vcards?id=eq.${id}&user_id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'saved' }),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
