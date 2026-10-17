import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { generateLoginCode, hashLoginCode, loginCodePepper } from '@/lib/otp';
import { normalizeUsPhone } from '@/lib/phone';
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
  | 'rate_limit'
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

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first.slice(0, 80);
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 80);
  return 'unknown';
}

async function readSetting(key: string, fallback: number, phase: AuthFailurePhase): Promise<number> {
  try {
    const rows = await sb(
      `/auth_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
      phase,
    );
    const value = Array.isArray(rows) ? rows[0]?.value : undefined;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 86_400) return value;
  } catch {
    // A missing settings row uses the same default the migration inserts.
  }
  return fallback;
}

const RATE_LIMIT_MESSAGE = 'Too many code requests. Wait a few minutes and try again.';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== 'string') return NextResponse.json({ error: 'Phone required' }, { status: 400 });

    const normalized = normalizeUsPhone(phone);
    if (!normalized) {
      return NextResponse.json({ error: 'Enter a valid 10-digit US phone number' }, { status: 400 });
    }

    const users = await sb(`/users?phone=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id`, 'eligibility_lookup');
    if (!Array.isArray(users)) throw new AuthDependencyError('database', 'eligibility_lookup', 'invalid_response');

    const verdict = await sb('/rpc/otp_try_send', 'rate_limit', {
      method: 'POST',
      body: JSON.stringify({ p_phone: normalized, p_ip: clientIp(req) }),
    });
    if (verdict !== 'ok' && verdict !== 'phone_limited' && verdict !== 'ip_limited') {
      throw new AuthDependencyError('database', 'rate_limit', 'invalid_response');
    }
    if (verdict !== 'ok') {
      const windowKey = verdict === 'ip_limited'
        ? 'otp_send_per_ip_window_sec'
        : 'otp_send_per_phone_window_sec';
      const retryAfter = await readSetting(windowKey, 600, 'rate_limit');
      logFailure(new AuthDependencyError('database', 'rate_limit', 'http', 429));
      return NextResponse.json(
        { error: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    if (users.length === 0) {
      return NextResponse.json({ error: 'This number is not registered. Contact Andre to get access.' }, { status: 403 });
    }

    if (!loginCodePepper()) {
      throw new AuthDependencyError('database', 'configuration', 'missing_config');
    }
    const code = generateLoginCode();
    const codeHash = hashLoginCode(normalized, code);
    const ttlSec = await readSetting('otp_ttl_sec', 600, 'otp_insertion');
    const ttlMinutes = Math.max(1, Math.round(ttlSec / 60));
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

    await sb(`/otp_codes?phone=eq.${encodeURIComponent(normalized)}&used=eq.false`, 'otp_invalidation', {
      method: 'PATCH',
      body: JSON.stringify({ used: true }),
    });

    const inserted = await sb('/otp_codes', 'otp_insertion', {
      method: 'POST',
      body: JSON.stringify({
        phone: normalized,
        code: null,
        code_hash: codeHash,
        expires_at: expiresAt,
        used: false,
        attempts: 0,
      }),
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
        body: `Your MyBiz Line code: ${code}. Valid for ${ttlMinutes} ${ttlMinutes === 1 ? 'minute' : 'minutes'}.`,
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
