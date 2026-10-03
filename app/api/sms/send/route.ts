import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function POST(req: NextRequest) {
  const { to, body, mediaUrl } = await req.json();
  if (!to) return NextResponse.json({ error: 'Missing to' }, { status: 400 });
  if (!body && !mediaUrl) return NextResponse.json({ error: 'Missing body or mediaUrl' }, { status: 400 });

  try {
    const params: any = {
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
    };
    if (body) params.body = body;
    if (mediaUrl) params.mediaUrl = [mediaUrl];

    const msg = await client.messages.create(params);
    return NextResponse.json({ sid: msg.sid, status: msg.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
