// Minimal server-side Supabase REST helper (service role). Server use only.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function sb(path: string, options?: RequestInit) {
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

export function digits10(p: string): string {
  return (p || '').replace(/\D/g, '').slice(-10);
}

/** Find a contact by phone regardless of stored formatting. */
export async function findContactByPhone(phone: string): Promise<any | null> {
  const d = digits10(phone);
  if (d.length < 7) return null;
  const last4 = d.slice(-4);
  try {
    const rows = await sb(`/biz_contacts?phone=ilike.*${last4}*&select=id,name,phone,business,notes&limit=50`);
    return (rows || []).find((c: any) => digits10(c.phone) === d) ?? null;
  } catch {
    return null;
  }
}

export async function sendSms(to: string, body: string) {
  const twilio = (await import('twilio')).default;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  return client.messages.create({ to, from: process.env.TWILIO_PHONE_NUMBER!, body });
}

export const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
