import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { normalizePhone } from '@/lib/contact-phone';

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
    console.error('Supabase error:', err);
    throw new Error(err);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const data = await sb(`/biz_contacts?user_id=eq.${userId}&order=name.asc`);
    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 503 });
  }
}

const CONTACT_FIELDS = ['name', 'phone', 'email', 'address', 'notes', 'business', 'tags', 'deal_tag'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContactInputResult = { data: Record<string, unknown>; error?: never } | { data?: never; error: string };

function contactInput(body: unknown, requireName: boolean, requirePhone: boolean, patch = false): ContactInputResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid contact data' };
  const input = body as Record<string, unknown>;
  if (patch && ('id' in input || 'user_id' in input)) return { error: 'Contact id and ownership cannot be changed' };

  const data: Record<string, unknown> = {};
  for (const field of CONTACT_FIELDS) {
    if (field === 'phone' || !(field in input)) continue;
    if (field === 'name' && (typeof input.name !== 'string' || !input.name.trim())) return { error: 'A contact name is required' };
    data[field] = input[field];
  }

  if (requireName && (typeof input.name !== 'string' || !input.name.trim())) return { error: 'A contact name is required' };
  if ('phone' in input) {
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) return { error: 'Enter a valid US phone number or an international number in E.164 format' };
    data.phone = normalizedPhone;
  } else if (requirePhone) {
    return { error: 'A contact phone number is required' };
  }

  if (!Object.keys(data).length) return { error: 'No contact fields to update' };
  return { data };
}

async function readJson(req: NextRequest): Promise<unknown | null> {
  try { return await req.json(); } catch { return null; }
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  const body = await readJson(req);
  if (body === null) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const input = contactInput(body, true, true);
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const data = await sb('/biz_contacts', {
      method: 'POST',
      body: JSON.stringify({ ...input.data, user_id: userId }),
    });
    return NextResponse.json(data || {});
  } catch {
    return NextResponse.json({ error: 'Failed to save contact' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'A valid contact id is required' }, { status: 400 });
  const body = await readJson(req);
  if (body === null) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const input = contactInput(body, false, false, true);
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    // Scope the row and force its existing owner; never trust ownership from the request body.
    const data = await sb('/biz_contacts?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: JSON.stringify({ ...input.data, user_id: userId }),
    });
    return NextResponse.json(data || {});
  } catch {
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}
export async function DELETE(req: NextRequest) {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    await sb(`/biz_contacts?id=eq.${id}&user_id=eq.${userId}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
