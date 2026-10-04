import { NextResponse } from 'next/server';
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return NextResponse.json([]);

  try {
    const [sent, received] = await Promise.all([
      client.messages.list({ from: process.env.TWILIO_PHONE_NUMBER, limit: 300 }),
      client.messages.list({ to: process.env.TWILIO_PHONE_NUMBER, limit: 300 }),
    ]);

    const all = [
      ...sent.map(m => ({ ...m, direction: 'outbound' as const, contact: m.to })),
      ...received.map(m => ({ ...m, direction: 'inbound' as const, contact: m.from })),
    ];

    const matches = all
      .filter(m => m.body && m.body.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.dateSent).getTime() - new Date(a.dateSent).getTime())
      .slice(0, 50)
      .map(m => ({
        sid: m.sid,
        contact: m.contact,
        body: m.body,
        direction: m.direction,
        dateSent: new Date(m.dateSent).toISOString(),
      }));

    return NextResponse.json(matches);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
