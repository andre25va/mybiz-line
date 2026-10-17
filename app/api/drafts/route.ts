import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { draftsQuery, pageDraftRows, parseDraftCursor, parseDraftLimit } from '@/lib/drafts-page';
import { sb, sendSms } from '@/lib/sb-rest';
import { DbError } from '@/lib/supabase-server';

export const maxDuration = 15;

function draftsUnavailable() {
  return NextResponse.json({ error: 'Drafts temporarily unavailable' }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const limit = parseDraftLimit(req.nextUrl.searchParams.get('limit'));
  const cursor = parseDraftCursor(req.nextUrl.searchParams.get('before'));
  if (cursor.invalid) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  try {
    const rows = await sb(draftsQuery(limit, cursor.iso));
    const page = pageDraftRows(Array.isArray(rows) ? rows : [], limit);
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof DbError) return draftsUnavailable();
    return NextResponse.json({ error: 'Failed to load drafts' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  const { id, action, customText } = await req.json();
  if (!id || !['send', 'skip'].includes(action)) {
    return NextResponse.json({ error: 'id and action (send|skip) required' }, { status: 400 });
  }
  const eid = encodeURIComponent(id);
  try {
    if (action === 'skip') {
      const rows = await sb(`/dispatcher_drafts?id=eq.${eid}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'skipped' }) });
      if (!rows?.length) return NextResponse.json({ error: 'Draft not pending' }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    const claimed = await sb(`/dispatcher_drafts?id=eq.${eid}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'sending' }) });
    const draft = claimed?.[0];
    if (!draft) return NextResponse.json({ error: 'Draft not pending' }, { status: 409 });
    const text = (typeof customText === 'string' && customText.trim()) || draft.draft_text;
    try {
      await sendSms(draft.from_number, text);
    } catch (err: any) {
      await sb(`/dispatcher_drafts?id=eq.${eid}`, { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) });
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    await sb(`/dispatcher_drafts?id=eq.${eid}`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', draft_text: text }) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DbError) return draftsUnavailable();
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
  }
}
