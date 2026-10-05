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

// GET /api/grok/calls?phone=... — call history for a number
// GET /api/grok/calls — recent call log
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const myNumber = process.env.TWILIO_PHONE_NUMBER!;

  let calls;
  if (phone) {
    const contact = toE164(phone);
    const [outbound, inbound] = await Promise.all([
      client.calls.list({ from: myNumber, to: contact, limit }),
      client.calls.list({ from: contact, to: myNumber, limit }),
    ]);
    const seen = new Set<string>();
    calls = [...outbound, ...inbound]
      .filter(c => { if (seen.has(c.sid)) return false; seen.add(c.sid); return true; })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  } else {
    calls = await client.calls.list({ limit });
  }

  const mapped = calls.map(c => ({
    sid: c.sid,
    from: c.from,
    to: c.to,
    direction: c.direction,
    status: c.status,
    duration: c.duration,
    startTime: c.startTime,
    endTime: c.endTime,
  }));

  return NextResponse.json({ calls: mapped, count: mapped.length });
}
