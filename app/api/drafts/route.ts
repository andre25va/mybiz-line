import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb, sendSms } from '@/lib/sb-rest';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  try {
    const rows = await sb(`/dispatcher_drafts?status=eq.pending&from_number=not.is.null&order=created_at.desc&limit=100`);
    return NextResponse.json(rows || []);
  } catch {
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
    // Claim the draft first so it can't be sent twice
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
  } catch {
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
  }
}
