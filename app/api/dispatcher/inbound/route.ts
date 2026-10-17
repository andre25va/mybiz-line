// app/api/dispatcher/inbound/route.ts
// Called by sms-inbound when a CLIENT replies — checks if we're waiting on their reply
// and forwards context + options to the owner

import { NextRequest, NextResponse } from 'next/server';
import { sendOptionsToOwner } from '@/lib/dispatcher';
import { sb, supabaseRest } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { userId, fromPhone, fromName, body, business } = await req.json();

  // Check if there's an active dispatcher session waiting on this contact
  let session: { id: string } | undefined;
  try {
    const rows = await sb(
      `/dispatcher_sessions?user_id=eq.${userId}&contact_phone=eq.${encodeURIComponent(fromPhone)}&status=eq.awaiting_reply&limit=1`,
    );
    session = Array.isArray(rows) ? rows[0] : undefined;
  } catch {
    session = undefined;
  }

  if (!session) return NextResponse.json({ handled: false });

  // Contact replied to our follow-up — notify owner with options
  await sendOptionsToOwner({ name: fromName, phone: fromPhone, business }, body);

  // Update session status
  const updated = await supabaseRest(`/dispatcher_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'awaiting_choice', last_client_reply: body }),
  });
  await updated.text().catch(() => '');

  return NextResponse.json({ handled: true });
}
