import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

function getSB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sb = getSB();
  const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const FROM = process.env.TWILIO_PHONE_NUMBER!;

  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const { data: group, error: gErr } = await sb
    .from('group_threads')
    .select('*')
    .eq('id', id)
    .single();
  if (gErr || !group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

  const members: { phone: string; name?: string }[] = group.members || [];
  const errors: string[] = [];

  for (const member of members) {
    try {
      await tw.messages.create({ from: FROM, to: member.phone, body });
    } catch (e: any) {
      errors.push(`${member.phone}: ${e.message}`);
    }
  }

  await sb.from('group_messages').insert({
    group_id: id,
    body,
    direction: 'outbound',
    from_number: FROM,
    date_sent: new Date().toISOString(),
  });

  await sb.from('group_threads').update({
    last_msg: body.slice(0, 100),
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  if (errors.length) return NextResponse.json({ ok: true, errors }, { status: 207 });
  return NextResponse.json({ ok: true, sent: members.length });
}
