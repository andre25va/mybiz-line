import { NextRequest } from 'next/server';
import { sb, sendSms, twiml } from '@/lib/sb-rest';

const ANDRE = process.env.TWILIO_FALLBACK_NUMBER || '+13129989898';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const from = String(form.get('From') || '');
  const body = String(form.get('Body') || '').trim();
  if (from !== ANDRE || !body) return twiml();

  let draft: any;
  try {
    const rows = await sb(`/dispatcher_drafts?status=eq.pending&from_number=not.is.null&order=created_at.desc&limit=1`);
    draft = rows?.[0];
  } catch (e) {
    console.error('draft lookup failed', e);
    return twiml('<Message>Draft lookup failed</Message>');
  }
  if (!draft) return twiml('<Message>No pending drafts</Message>');

  const patch = (status: string) =>
    sb(`/dispatcher_drafts?id=eq.${draft.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });

  if (body === '2') {
    await patch('skipped');
    return twiml('<Message>✓ Skipped</Message>');
  }
  if (body === '1') {
    await sendSms(draft.from_number, draft.draft_text);
    await patch('sent');
    return twiml();
  }
  await sendSms(draft.from_number, body);
  await patch('sent');
  return twiml('<Message>✓ Sent</Message>');
}
