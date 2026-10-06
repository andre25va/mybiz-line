import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function sb(path: string, options?: RequestInit) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...((options?.headers as Record<string, string>) || {}),
    },
  });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ error: 'Phone required' }, { status: 400 });

    const normalized = normalizePhone(phone);

    // Check user exists and is active
    const users = await sb(`/users?phone=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id`);
    if (!users || users.length === 0) {
      return NextResponse.json({ error: 'This number is not registered. Contact Andre to get access.' }, { status: 403 });
    }

    // Generate 6-digit OTP
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate old OTPs
    await sb(`/otp_codes?phone=eq.${encodeURIComponent(normalized)}&used=eq.false`, {
      method: 'PATCH',
      body: JSON.stringify({ used: true }),
    });

    // Save new OTP
    await sb('/otp_codes', {
      method: 'POST',
      body: JSON.stringify({ phone: normalized, code, expires_at: expiresAt }),
    });

    // Send SMS via Twilio
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    await client.messages.create({
      to: normalized,
      from: process.env.TWILIO_PHONE_NUMBER!,
      body: `Your MyBiz Line code: ${code}. Valid for 10 minutes.`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('send-otp error:', e.message || e);
    return NextResponse.json({ error: e.message || 'Failed to send code' }, { status: 500 });
  }
}
