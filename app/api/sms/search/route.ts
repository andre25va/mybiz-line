import { NextResponse } from 'next/server';
import twilio from 'twilio';
import {
  businessNumber,
  fetchNumberMessages,
  messageTime,
  messagingServiceSids,
  otherParty,
} from '@/lib/sms-traffic';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return NextResponse.json([]);

  try {
    const ourNumber = businessNumber();
    const serviceSids = messagingServiceSids();
    const messages = await fetchNumberMessages(client, { ourNumber, serviceSids, limit: 300 });
    const matches = messages
      .filter((m) => m.body && m.body.toLowerCase().includes(q))
      .sort((a, b) => messageTime(b).getTime() - messageTime(a).getTime())
      .slice(0, 50)
      .map((m) => ({
        sid: m.sid,
        contact: otherParty(m, ourNumber, serviceSids),
        body: m.body,
        direction: m.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
        dateSent: messageTime(m).toISOString(),
      }));

    return NextResponse.json(matches);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
