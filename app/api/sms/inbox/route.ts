import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { buildConversations, businessNumber, fetchNumberMessages, messagingServiceSids } from '@/lib/sms-traffic';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET() {
  try {
    const ourNumber = businessNumber();
    const serviceSids = messagingServiceSids();
    const messages = await fetchNumberMessages(client, { ourNumber, serviceSids, limit: 100 });
    return NextResponse.json(buildConversations(messages, ourNumber, serviceSids));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
