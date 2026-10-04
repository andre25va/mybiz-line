import { NextRequest, NextResponse } from 'next/server';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ name: null });

  try {
    const encoded = encodeURIComponent(phone);
    const url = `https://lookups.twilio.com/v1/PhoneNumbers/${encoded}?Type=caller-name`;
    const res = await fetch(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
      },
    });
    if (!res.ok) return NextResponse.json({ name: null });
    const data = await res.json();
    const name = data?.caller_name?.caller_name ?? null;
    return NextResponse.json({ name });
  } catch {
    return NextResponse.json({ name: null });
  }
}
