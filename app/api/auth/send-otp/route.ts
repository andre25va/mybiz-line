import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

// maxDuration caps platform execution; individual dependency timeouts imply only a nominal 25s budget.
export const maxDuration = 30;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OTP_DB_REQUEST_TIMEOUT_MS = 5_000;
const OTP_TWILIO_REQUEST_TIMEOUT_MS = 10_000;

class AuthDependencyError extends Error {
  constructor(readonly dependency: 'database' | 'sms') {
    super(dependency);
    this.name = 'AuthDependencyError';
  }
}

async function sb(path: string, options?: RequestInit) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new AuthDependencyError('database');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...options,
      signal: AbortSignal.timeout(OTP_DB_REQUEST_TIMEOUT_MS),
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
    const text = await r.text();
    if (!r.ok) throw new AuthDependencyError('database');
    return text ? JSON.parse(text) : null;
  } catch {
    // Never forward or log upstream response text, which can contain sensitive details.
    throw new AuthDependencyError('database');
  }
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
    if (!Array.isArray(users)) throw new AuthDependencyError('database');
    if (users.length === 0) {
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
    const inserted = await sb('/otp_codes', {
      method: 'POST',
      body: JSON.stringify({ phone: normalized, code, expires_at: expiresAt }),
    });
    if (!Array.isArray(inserted) || inserted.length === 0) {
      throw new AuthDependencyError('database');
    }

    // Send SMS via Twilio
    try {
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID!,
        process.env.TWILIO_AUTH_TOKEN!,
        { timeout: OTP_TWILIO_REQUEST_TIMEOUT_MS, autoRetry: false },
      );
      await client.messages.create({
        to: normalized,
        from: process.env.TWILIO_PHONE_NUMBER!,
        body: `Your MyBiz Line code: ${code}. Valid for 10 minutes.`,
      });
    } catch {
      throw new AuthDependencyError('sms');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const dependency = error instanceof AuthDependencyError ? error.dependency : 'database';
    // Log only the dependency class; never log phone numbers, codes, tokens, or provider bodies.
    console.error('send-otp failed:', dependency);
    return NextResponse.json(
      {
        error: dependency === 'sms'
          ? 'Could not confirm delivery. A code may still arrive; check before requesting another.'
          : 'Sign-in is temporarily unavailable. Please try again shortly.',
      },
      { status: dependency === 'sms' ? 502 : 503 },
    );
  }
}
