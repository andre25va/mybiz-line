import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

function getSB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+14647333257';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mybiz-line-git-main-andre25vas-projects.vercel.app';

function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

async function sendWelcomeSMS(toPhone: string, name: string) {
  const body = `Hi ${name}! Your MyBiz Line account is ready. Log in at ${APP_URL} using this number. Welcome aboard! 🚀`;
  const params = new URLSearchParams({ To: toPhone, From: TWILIO_FROM, Body: body });
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

const USER_LIST_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

const USER_LIST_UNAVAILABLE = 'User list is unavailable.';

function userListResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: USER_LIST_HEADERS });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function toPublicUser(row: unknown) {
  if (!isPlainObject(row)) return null;
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.phone !== 'string') return null;
  if (!isNullableBoolean(row.is_admin) || !isNullableBoolean(row.is_active)) return null;
  if (!isNullableString(row.created_at) || !isNullableString(row.last_login)) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    is_admin: row.is_admin,
    is_active: row.is_active,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

async function readUserRows(url: string, serviceKey: string): Promise<unknown[] | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) {
    for (const [name, value] of Object.entries(USER_LIST_HEADERS)) {
      session.headers.set(name, value);
    }
    return session;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return userListResponse({ error: USER_LIST_UNAVAILABLE }, 503);

  const authUrl =
    `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(session.userId)}` +
    '&select=is_admin,is_active&limit=1';
  const authRows = await readUserRows(authUrl, serviceKey);
  if (!authRows) return userListResponse({ error: USER_LIST_UNAVAILABLE }, 503);
  if (authRows.length === 0) return userListResponse({ error: 'Forbidden' }, 403);
  const authRow = authRows[0];
  if (!isPlainObject(authRow)) return userListResponse({ error: USER_LIST_UNAVAILABLE }, 503);
  if (authRow.is_admin !== true || authRow.is_active !== true) return userListResponse({ error: 'Forbidden' }, 403);

  const listUrl =
    `${supabaseUrl}/rest/v1/users?select=id,name,phone,is_admin,is_active,created_at,last_login` +
    '&order=created_at.asc';
  const listed = await readUserRows(listUrl, serviceKey);
  if (!listed) return userListResponse({ error: USER_LIST_UNAVAILABLE }, 503);
  const users = [];
  for (const row of listed) {
    const user = toPublicUser(row);
    if (!user) return userListResponse({ error: USER_LIST_UNAVAILABLE }, 503);
    users.push(user);
  }
  return userListResponse({ users }, 200);
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const supabase = getSB();
  const { data: me } = await supabase.from('users').select('role').eq('id', session.userId).single();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { name, phone, email } = await req.json();
  if (!name || !phone) return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 });
  const normalized = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
  const { data: existing } = await supabase.from('users').select('id').eq('phone', normalized).single();
  if (existing) return NextResponse.json({ error: 'An account with this phone number already exists' }, { status: 409 });
  const api_key = generateApiKey();
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ name, phone: normalized, email: email || null, role: 'user', status: 'active', api_key })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await sendWelcomeSMS(normalized, name.split(' ')[0]); } catch (e) { console.error('Welcome SMS failed:', e); }
  return NextResponse.json({ user: newUser }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const supabase = getSB();
  const { data: me } = await supabase.from('users').select('role').eq('id', session.userId).single();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id, status } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  const { error } = await supabase.from('users').update({ status }).eq('id', id).neq('role', 'admin');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
