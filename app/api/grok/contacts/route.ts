import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/contact-phone';
import { validateGrokKey } from '@/lib/grok-auth';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

class ContactDatabaseError extends Error {
  constructor(
    readonly kind: 'http' | 'network' | 'response',
    readonly providerCode?: string,
  ) {
    super('Contact database request failed');
  }
}

const SAFE_PROVIDER_CODE = /^[A-Za-z0-9_-]{1,32}$/;

async function sb(path: string, options?: RequestInit, throwOnError = false) {
  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  } catch (error) {
    if (throwOnError) throw new ContactDatabaseError('network');
    throw error;
  }
  if (!r.ok) {
    if (!throwOnError) {
      const err = await r.text();
      console.error('Supabase error:', err);
      return null;
    }
    let providerCode: string | undefined;
    try {
      const providerError = await r.json() as { code?: unknown };
      if (typeof providerError?.code === 'string' && SAFE_PROVIDER_CODE.test(providerError.code)) {
        providerCode = providerError.code;
      }
    } catch {
      // Do not retain or log the provider body: it may contain contact data.
    }
    console.error('Supabase request failed', { status: r.status, ...(providerCode ? { code: providerCode } : {}) });
    if (throwOnError) throw new ContactDatabaseError('http', providerCode);
    return null;
  }
  const text = await r.text();
  if (!throwOnError) return text ? JSON.parse(text) : null;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    if (throwOnError) throw new ContactDatabaseError('response');
    throw new Error('Invalid Supabase response');
  }
}

const PATCH_FIELDS = ['name', 'phone', 'email', 'address', 'notes', 'business', 'tags', 'deal_tag', 'status'] as const;

// GET /api/grok/contacts?phone=... or ?name=... or ?q=...
// POST /api/grok/contacts — create { name, phone, email?, business?, tags?, notes?, address? }
// PATCH /api/grok/contacts — update { phone (legacy lookup key), ...fields }
// To update a contact's phone, use { lookup_phone: currentPhone, phone: newPhone }.
export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  const name = searchParams.get('name');
  const q = searchParams.get('q');

  let filter = '';
  if (phone) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    filter = `?phone=ilike.*${digits}*&order=name.asc`;
  } else if (name) {
    filter = `?name=ilike.*${encodeURIComponent(name)}*&order=name.asc`;
  } else if (q) {
    filter = `?or=(name.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*)&order=name.asc`;
  } else {
    filter = '?order=name.asc&limit=100';
  }

  const data = await sb(`/biz_contacts${filter}`);
  return NextResponse.json({ contacts: data || [], count: (data || []).length });
}

export async function POST(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const body = await req.json();
  const { name, phone } = body;
  if (!name || !phone) return NextResponse.json({ error: 'name and phone are required' }, { status: 400 });

  const data = await sb('/biz_contacts', {
    method: 'POST',
    body: JSON.stringify({ ...body, business: body.business ?? 'personal', created_at: new Date().toISOString() }),
  });
  return NextResponse.json({ success: true, contact: data?.[0] || data });
}

export async function PATCH(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const hasSeparateLookup = Object.prototype.hasOwnProperty.call(input, 'lookup_phone');
  const lookupPhone = hasSeparateLookup ? input.lookup_phone : input.phone;
  const normalizedLookup = normalizePhone(lookupPhone);
  if (!normalizedLookup) {
    return NextResponse.json({ error: 'A valid phone number is required to identify contact' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    // Preserve the existing request contract: without lookup_phone, phone is
    // the selector and must never accidentally become an update value.
    if (field === 'phone' && !hasSeparateLookup) continue;
    if (field === 'name' && (typeof input.name !== 'string' || !input.name.trim())) {
      return NextResponse.json({ error: 'A contact name must be a non-empty string' }, { status: 400 });
    }
    if (field === 'phone') {
      const normalizedPhone = normalizePhone(input.phone);
      if (!normalizedPhone) {
        return NextResponse.json({ error: 'Enter a valid US phone number or an international number in E.164 format' }, { status: 400 });
      }
      updates.phone = normalizedPhone;
    } else {
      updates[field] = input[field];
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'At least one contact field is required' }, { status: 400 });
  }

  const digits = normalizedLookup.replace(/\D/g, '').slice(-10);
  try {
    // Keep phone matching compatible, but never choose between partial/duplicate matches.
    const matches = await sb(`/biz_contacts?phone=ilike.*${digits}*&select=id&limit=2`, undefined, true);
    if (!Array.isArray(matches)) throw new ContactDatabaseError('response');
    if (matches.length === 0) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (matches.length !== 1) return NextResponse.json({ error: 'Phone number matches multiple contacts' }, { status: 409 });

    const contactId = matches[0]?.id;
    if (typeof contactId !== 'string' || !contactId) throw new ContactDatabaseError('response');
    const updated = await sb(`/biz_contacts?id=eq.${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }, true);
    if (!Array.isArray(updated)) throw new ContactDatabaseError('response');
    if (updated.length === 0) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (updated.length !== 1) return NextResponse.json({ error: 'Contact update did not affect exactly one record' }, { status: 409 });
    return NextResponse.json({ success: true, contact: updated[0] });
  } catch (error) {
    if (error instanceof ContactDatabaseError && error.kind === 'network') {
      return NextResponse.json({ error: 'Contact database is unavailable' }, { status: 503 });
    }
    return NextResponse.json({
      error: 'Failed to update contact',
      ...(error instanceof ContactDatabaseError && error.providerCode ? { providerCode: error.providerCode } : {}),
    }, { status: 502 });
  }
}
