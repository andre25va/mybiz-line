import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { to, subject, text, html } = await req.json();
  if (!to || !subject) return NextResponse.json({ error: 'Missing to or subject' }, { status: 400 });

  try {
    await sendEmail({ to, subject, text, html });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Email send error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
