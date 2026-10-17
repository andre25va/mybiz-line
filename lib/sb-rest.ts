// Server-side Supabase REST helper. sb() lives in lib/supabase-server.ts.
import { DbError, sb } from './supabase-server';

export { DbError, sb };

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
