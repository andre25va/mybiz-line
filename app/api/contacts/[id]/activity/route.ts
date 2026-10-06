import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb, digits10 } from '@/lib/sb-rest';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  const { id } = await ctx.params;

  try {
    const found = await sb(`/biz_contacts?id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}&select=id,name,phone&limit=1`);
    const contact = found?.[0];
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const d = digits10(contact.phone);
    const last4 = d.slice(-4);
    const name = (contact.name || '').replace(/[,()*%\\]/g, ' ').trim();

    const vmReq = d.length >= 7
      ? sb(`/voicemails?user_id=eq.${userId}&caller_number=ilike.${encodeURIComponent(`*${last4}*`)}&order=created_at.desc&limit=50`)
      : Promise.resolve([]);

    // call_recordings has no caller_number column; match on transcript mentioning the contact name.
    const recReq = name.length >= 3
      ? sb(`/call_recordings?user_id=eq.${userId}&transcript=ilike.${encodeURIComponent(`*${name}*`)}&order=created_at.desc&limit=50`)
      : Promise.resolve([]);

    const terms = [name.length >= 3 ? name : '', d.length >= 7 ? d.slice(-7) : ''].filter(Boolean);
    const taskReq = terms.length
      ? sb(`/biz_tasks?user_id=eq.${userId}&or=(${terms.map(t => `notes.ilike.${encodeURIComponent(`*${t}*`)},title.ilike.${encodeURIComponent(`*${t}*`)}`).join(',')})&order=created_at.desc&limit=50`)
      : Promise.resolve([]);

    const [vms, recs, tasks] = await Promise.all([vmReq, recReq, taskReq]);

    const items = [
      ...(vms || []).filter((v: any) => digits10(v.caller_number) === d).map((v: any) => ({
        type: 'voicemail', id: v.id, created_at: v.created_at,
        description: v.transcript || `Voicemail (${v.duration_seconds || 0}s)`,
      })),
      ...(recs || []).map((r: any) => ({
        type: 'call', id: r.id, created_at: r.created_at,
        description: (r.ai_summary && (r.ai_summary.summary || (typeof r.ai_summary === 'string' ? r.ai_summary : ''))) || r.transcript?.slice(0, 160) || `Call (${r.duration_seconds || 0}s)`,
      })),
      ...(tasks || []).map((t: any) => ({
        type: 'task', id: t.id, created_at: t.created_at,
        description: t.title + (t.done ? ' (done)' : ''),
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json(items);
  } catch {
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
}
