import { NextResponse } from 'next/server';
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET() {
  try {
    const [sent, received] = await Promise.all([
      client.messages.list({ from: process.env.TWILIO_PHONE_NUMBER, limit: 100 }),
      client.messages.list({ to: process.env.TWILIO_PHONE_NUMBER, limit: 100 }),
    ]);

    // Build conversation map keyed by contact number
    const convoMap = new Map<string, {
      number: string;
      lastMsg: string;
      lastTime: Date;
      unread: number;
      lastDirection: 'inbound' | 'outbound';
    }>();

    for (const m of sent) {
      const num = m.to;
      const existing = convoMap.get(num);
      const t = new Date(m.dateSent);
      if (!existing || t > existing.lastTime) {
        convoMap.set(num, {
          number: num,
          lastMsg: m.body,
          lastTime: t,
          unread: existing?.unread ?? 0,
          lastDirection: 'outbound',
        });
      }
    }

    for (const m of received) {
      const num = m.from;
      const existing = convoMap.get(num);
      const t = new Date(m.dateSent);
      if (!existing || t > existing.lastTime) {
        convoMap.set(num, {
          number: num,
          lastMsg: m.body,
          lastTime: t,
          unread: existing ? existing.unread + 1 : 1,
          lastDirection: 'inbound',
        });
      }
    }

    const convos = Array.from(convoMap.values())
      .sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime())
      .map(c => ({ ...c, lastTime: c.lastTime.toISOString() }));

    return NextResponse.json(convos);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
