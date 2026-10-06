import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sb } from '@/lib/sb-rest';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  // user_id is always taken from the session cookie; a client-supplied user_id is ignored for safety.
  const { userId } = session;

  const raw = new URL(req.url).searchParams.get('q') || '';
  const q = raw.replace(/[,()*%\\]/g, ' ').trim();
  if (q.length < 2) return NextResponse.json({ contacts: [], voicemails: [], tasks: [] });
  const p = encodeURIComponent(`*${q}*`);

  try {
    const [contacts, voicemails, tasks] = await Promise.all([
      sb(`/biz_contacts?user_id=eq.${userId}&or=(name.ilike.${p},phone.ilike.${p},notes.ilike.${p})&order=name.asc&limit=20`),
      sb(`/voicemails?user_id=eq.${userId}&transcript=ilike.${p}&order=created_at.desc&limit=20`),
      sb(`/biz_tasks?user_id=eq.${userId}&or=(title.ilike.${p},notes.ilike.${p})&order=created_at.desc&limit=20`),
    ]);
    return NextResponse.json({ contacts: contacts || [], voicemails: voicemails || [], tasks: tasks || [] });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
