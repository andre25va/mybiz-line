import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';

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
  if (!r.ok) {
    const err = await r.text();
    throw new Error(err);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

/** POST /api/admin/invite — admin only. Body: { phone, name } */
export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  // Verify caller is admin
  const admins = await sb(`/users?id=eq.${userId}&is_admin=eq.true&select=id&limit=1`);
  if (!admins || admins.length === 0) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { phone, name } = await req.json();
  if (!phone || !name) return NextResponse.json({ error: 'phone and name required' }, { status: 400 });

  const normalized = normalizePhone(phone);

  try {
    const data = await sb('/users', {
      method: 'POST',
      body: JSON.stringify({
        phone: normalized,
        name,
        is_admin: false,
        is_active: true,
        invited_by: userId,
      }),
    });
    return NextResponse.json(data?.[0] || {});
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 });
  }
}
