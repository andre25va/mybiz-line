import { NextRequest } from 'next/server';
import { sb, findContactByPhone, sendSms, twiml } from '@/lib/sb-rest';

const ANDRE = process.env.TWILIO_FALLBACK_NUMBER || '+13129989898';

async function draftReply(body: string, contact: any | null): Promise<string> {
  const ctx = contact
    ? `Sender is a saved contact: ${contact.name} (business: ${contact.business}). Notes: ${contact.notes || 'none'}.`
    : 'Sender is not a saved contact.';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              'You draft short, friendly, professional SMS replies on behalf of Andre Vargas (real estate at MyReDeal and Contractors of KC). Keep under 300 characters. Do not make promises about price or availability. Reply with the text only. ' + ctx,
          },
          { role: 'user', content: body },
        ],
      }),
    });
    const j = await r.json();
    return (j?.choices?.[0]?.message?.content || '').trim().replace(/^"|"$/g, '') || 'Thanks for your message! I will get back to you shortly.';
  } catch {
    return 'Thanks for your message! I will get back to you shortly.';
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const from = String(form.get('From') || '');
  const to = String(form.get('To') || '');
  const body = String(form.get('Body') || '');
  if (!from || !body) return twiml();
  // Never process Andre's own approval replies as customer messages (prevents loops)
  if (from === ANDRE) return twiml();

  const contact = await findContactByPhone(from);

  // Save inbound message (best effort)
  try {
    await sb('/messages', {
      method: 'POST',
      body: JSON.stringify({ direction: 'inbound', channel: 'sms', body, from_number: from, to_number: to, status: 'received', contact_id: contact?.id ?? null }),
    });
  } catch (e) {
    console.error('inbound save failed', e);
  }

  const draft = await draftReply(body, contact);

  try {
    await sb('/dispatcher_drafts', {
      method: 'POST',
      body: JSON.stringify({ status: 'pending', from_number: from, to_number: to, draft_text: draft, original_message: body }),
    });
  } catch (e) {
    console.error('draft save failed (run supabase/migrations/004_drafts_columns.sql)', e);
  }

  try {
    await sendSms(
      ANDRE,
      `📨 New SMS from ${contact?.name || from}:\n"${body}"\n\nAI draft: "${draft}"\n\nReply with:\n1 - Send draft\n2 - Skip\nOr reply with your own text to send that instead`
    );
  } catch (e) {
    console.error('approval sms failed', e);
  }
  return twiml();
}
