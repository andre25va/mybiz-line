import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

export async function POST(req: NextRequest) {
  try {
    const { callSid } = await req.json();
    if (!callSid) return NextResponse.json({ error: 'callSid required' }, { status: 400 });

    const relayUrl = `${APP_URL}/api/conversation-relay`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    // Redirect the live call to AI receptionist
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Url: relayUrl, Method: 'POST' }).toString(),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
