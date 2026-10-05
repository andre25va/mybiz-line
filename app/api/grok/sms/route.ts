import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { validateGrokKey } from '@/lib/grok-auth';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

// GET /api/grok/sms?phone=+12345678900 — read thread
// GET /api/grok/sms — list all recent conversations
// POST /api/grok/sms — send a message { to, body }
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  const myNumber = process.env.TWILIO_PHONE_NUMBER!;

  if (phone) {
    // Read specific thread
    const contact = toE164(phone);
    const [sent, received, allTo] = await Promise.all([
      client.messages.list({ from: myNumber, to: contact, limit: 100 }),
      client.messages.list({ from: contact, to: myNumber, limit: 100 }),
      client.messages.list({ to: contact, limit: 50 }),
    ]);
    const seen = new Set<string>();
    const all = [...sent, ...received, ...allTo]
      .filter(m => { if (seen.has(m.sid)) return false; seen.add(m.sid); return true; })
      .filter(m => m.from === myNumber || m.to === myNumber || m.from === contact || m.to === contact)
      .sort((a, b) => new Date(a.dateSent).getTime() - new Date(b.dateSent).getTime())
      .map(m => ({ sid: m.sid, from: m.from, to: m.to, body: m.body, direction: m.direction, status: m.status, dateSent: m.dateSent }));
    return NextResponse.json({ thread: all, count: all.length });
  }

  // List all recent conversations (last message per number)
  const recent = await client.messages.list({ limit: 200 });
  const convos = new Map<string, any>();
  for (const m of recent) {
    const other = m.from === myNumber ? m.to : m.from;
    if (!convos.has(other)) {
      convos.set(other, { phone: other, lastMessage: m.body, direction: m.direction, dateSent: m.dateSent, status: m.status });
    }
  }
  return NextResponse.json({ conversations: Array.from(convos.values()), count: convos.size });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { to, message } = body;
  if (!to || !message) return NextResponse.json({ error: 'to and message are required' }, { status: 400 });

  const msg = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: toE164(to),
    body: message,
  });
  return NextResponse.json({ success: true, sid: msg.sid, status: msg.status });
}
