import { NextRequest, NextResponse } from 'next/server';
import { hashLoginCode, loginCodePepper } from '@/lib/otp';
import { normalizeUsPhone } from '@/lib/phone';
import { signSession } from '@/lib/session';
import { DbError, sb } from '@/lib/supabase-server';

const SIGN_IN_UNAVAILABLE = 'Sign-in service is temporarily unavailable. Please try again in a few minutes.';
const LOCKED_MESSAGE = 'Too many attempts. Request a new code.';

function unavailable() {
  return NextResponse.json({ error: SIGN_IN_UNAVAILABLE }, { status: 503 });
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json();
    if (!phone || !code || typeof phone !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ error: 'Phone and code required' }, { status: 400 });
    }

    const normalized = normalizeUsPhone(phone);
    if (!normalized) {
      return NextResponse.json({ error: 'Enter a valid 10-digit US phone number' }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 });
    }
    if (!loginCodePepper()) return unavailable();

    const verdict = await sb('/rpc/otp_verify', {
      method: 'POST',
      body: JSON.stringify({ p_phone: normalized, p_code_hash: hashLoginCode(normalized, code) }),
    });

    if (verdict === 'locked') {
      return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 429 });
    }
    if (verdict === 'invalid') {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
    }
    if (verdict !== 'ok') return unavailable();

    const users = await sb(`/users?phone=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id,name,is_admin&limit=1`);
    if (!Array.isArray(users)) return unavailable();
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found or suspended' }, { status: 403 });
    }

    const user = users[0];
    const token = signSession(user.id);
    const res = NextResponse.json({ ok: true, name: user.name, isAdmin: user.is_admin === true });
    res.cookies.set('mbl_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    res.cookies.delete('mbl_auth');
    return res;
  } catch (error) {
    const kind = error instanceof DbError ? error.kind : 'unknown';
    const status = error instanceof DbError ? error.status ?? null : null;
    console.error(JSON.stringify({ event: 'verify-otp.failure', kind, status }));
    return unavailable();
  }
}
