import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+14647333257';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+13129989898';

function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

async function sendWelcomeSMS(toPhone: string, name: string) {
  const body = `Hi ${name}! Your MyBiz Line account is ready. Log in at ${APP_URL} using this number. Welcome aboard! 🚀`;
  const params = new URLSearchParams({
    To: toPhone,
    From: TWILIO_FROM,
    Body: body,
  });
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );
}

// GET /api/admin/users — list all users
export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  // Only admin (Andre) can access
  const { data: me } = await supabase
    .from('users')
    .select('role, phone')
    .eq('id', session.userId)
    .single();

  if (me?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, phone, email, role, status, api_key, created_at')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users });
}

// POST /api/admin/users — create a new user
export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('id', session.userId)
    .single();

  if (me?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, phone, email } = await req.json();
  if (!name || !phone) {
    return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 });
  }

  // Normalize phone to E.164
  const normalized = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;

  // Check duplicate
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', normalized)
    .single();

  if (existing) {
    return NextResponse.json({ error: 'An account with this phone number already exists' }, { status: 409 });
  }

  const api_key = generateApiKey();

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ name, phone: normalized, email: email || null, role: 'user', status: 'active', api_key })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send welcome SMS
  try {
    await sendWelcomeSMS(normalized, name.split(' ')[0]);
  } catch (e) {
    console.error('Welcome SMS failed:', e);
  }

  return NextResponse.json({ user: newUser }, { status: 201 });
}

// PATCH /api/admin/users — update user status
export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('id', session.userId)
    .single();

  if (me?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, status } = await req.json();
  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('users')
    .update({ status })
    .eq('id', id)
    .neq('role', 'admin'); // can never suspend admin

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
