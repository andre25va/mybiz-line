import { NextRequest, NextResponse } from 'next/server';
import { signSession } from '@/lib/session';

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
    const { phone, code } = await req.json();
    if (!phone || !code) return NextResponse.json({ error: 'Phone and code required' }, { status: 400 });

    const normalized = normalizePhone(phone);

    const otps = await sb(
      `/otp_codes?phone=eq.${encodeURIComponent(normalized)}&code=eq.${code}&used=eq.false&expires_at=gt.${new Date().toISOString()}&select=id&limit=1`
    );

    if (!otps || otps.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
    }

    await sb(`/otp_codes?id=eq.${otps[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ used: true }),
    });

    const users = await sb(`/users?phone=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id,name,is_admin&limit=1`);
    if (!users || users.length === 0) {
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
  } catch (e: any) {
    console.error('verify-otp error:', e);
    return NextResponse.json({ error: e.message || 'Verification failed' }, { status: 500 });
  }
}
