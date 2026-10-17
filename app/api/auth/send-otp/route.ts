import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { classifyError, DbError, safeNumericProperty, sb as sharedSb } from '@/lib/supabase-server';

// maxDuration caps platform execution; individual dependency timeouts imply only a nominal 25s budget.
export const maxDuration = 30;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OTP_DB_REQUEST_TIMEOUT_MS = 5_000;
const OTP_TWILIO_REQUEST_TIMEOUT_MS = 10_000;

type AuthFailurePhase =
  | 'configuration'
  | 'eligibility_lookup'
  | 'otp_invalidation'
  | 'otp_insertion'
  | 'sms'
  | 'request';

type AuthFailureClass =
  | 'missing_config'
  | 'invalid_config'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_response'
  | 'provider'
  | 'unknown';

class AuthDependencyError extends Error {
  constructor(
    readonly dependency: 'database' | 'sms',
    readonly phase: AuthFailurePhase,
    readonly failureClass: AuthFailureClass,
    readonly upstreamStatus?: number,
    readonly providerCode?: number,
  ) {
    super('Authentication dependency failed');
    this.name = 'AuthDependencyError';
  }
}

function logFailure(error: AuthDependencyError): void {
  const fields: Record<string, string | number> = {
    event: 'send-otp.failure',
    phase: error.phase,
    errorClass: error.failureClass,
  };
  if (error.upstreamStatus !== undefined) fields.upstreamStatus = error.upstreamStatus;
  if (error.providerCode !== undefined) fields.providerCode = error.providerCode;
  // Only fixed labels and range-checked integers are logged; never include raw errors or request data.
  console.error(JSON.stringify(fields));
}

function configError(): AuthDependencyError | undefined {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new AuthDependencyError('database', 'configuration', 'missing_config');
  }
  try {
    const url = new URL(SUPABASE_URL);
    if (!url.hostname || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      return new AuthDependencyError('database', 'configuration', 'invalid_config');
    }
  } catch {
    return new AuthDependencyError('database', 'configuration', 'invalid_config');
  }
  return undefined;
}

async function sb(path: string, phase: AuthFailurePhase, options?: RequestInit) {
  const configurationError = configError();
  if (configurationError) throw configurationError;
  try {
    return await sharedSb(path, { ...options, timeoutMs: OTP_DB_REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof AuthDependencyError) throw error;
    if (error instanceof DbError) {
      const failureClass: AuthFailureClass = error.kind;
      throw new AuthDependencyError('database', phase, failureClass, error.kind === 'http' ? error.status : undefined);
    }
    throw new AuthDependencyError('database', phase, classifyError(error));
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
    const users = await sb(`/users?phone=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id`, 'eligibility_lookup');
    if (!Array.isArray(users)) throw new AuthDependencyError('database', 'eligibility_lookup', 'invalid_response');
    if (users.length === 0) {
      return NextResponse.json({ error: 'This number is not registered. Contact Andre to get access.' }, { status: 403 });
    }

    // Generate 6-digit OTP
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate old OTPs
    await sb(`/otp_codes?phone=eq.${encodeURIComponent(normalized)}&used=eq.false`, 'otp_invalidation', {
      method: 'PATCH',
      body: JSON.stringify({ used: true }),
    });

    // Save new OTP
    const inserted = await sb('/otp_codes', 'otp_insertion', {
      method: 'POST',
      body: JSON.stringify({ phone: normalized, code, expires_at: expiresAt }),
    });
    if (!Array.isArray(inserted) || inserted.length === 0) {
      throw new AuthDependencyError('database', 'otp_insertion', 'invalid_response');
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
    } catch (error) {
      const status = safeNumericProperty(error, 'status', 100, 599);
      const providerCode = safeNumericProperty(error, 'code', 0, 999999);
      throw new AuthDependencyError('sms', 'sms', classifyError(error), status, providerCode);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const dependency = error instanceof AuthDependencyError ? error.dependency : 'database';
    // Log only fixed phase/class labels and optional sanitized numbers.
    logFailure(error instanceof AuthDependencyError
      ? error
      : new AuthDependencyError('database', 'request', classifyError(error)));
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
