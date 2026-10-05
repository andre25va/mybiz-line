// app/api/dispatcher/inbound/route.ts
// Called by sms-inbound when a CLIENT replies — checks if we're waiting on their reply
// and forwards context + options to the owner

import { NextRequest, NextResponse } from 'next/server';
import { sendOptionsToOwner, sendSMS, OWNER_NUMBER } from '@/lib/dispatcher';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const { userId, fromPhone, fromName, body, business } = await req.json();

  // Check if there's an active dispatcher session waiting on this contact
  const sessionRes = await fetch(
    `${supabaseUrl}/rest/v1/dispatcher_sessions?user_id=eq.${userId}&contact_phone=eq.${encodeURIComponent(fromPhone)}&status=eq.awaiting_reply&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const [session] = await sessionRes.json().catch(() => []);

  if (!session) return NextResponse.json({ handled: false });

  // Contact replied to our follow-up — notify owner with options
  await sendOptionsToOwner({ name: fromName, phone: fromPhone, business }, body);

  // Update session status
  await fetch(`${supabaseUrl}/rest/v1/dispatcher_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'awaiting_choice', last_client_reply: body }),
  });

  return NextResponse.json({ handled: true });
}
