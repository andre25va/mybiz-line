import { NextRequest } from 'next/server';
import { sb, findContactByPhone, sendSms, twiml } from '@/lib/sb-rest';

const ANDRE = process.env.TWILIO_FALLBACK_NUMBER || '+13129989898';
const OUR_NUMBER = process.env.TWILIO_NUMBER || '+14647333257';

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

/**
 * Detect if this is a group MMS message.
 * Twilio includes NumMedia >= 0 and may include To with multiple recipients,
 * but more reliably, group MMS threads have a MessagingServiceSid or
 * the To field contains our number and From is a real user.
 * We detect group by checking if there are more participants beyond From→To.
 */
async function handleGroupMessage(from: string, to: string, body: string, numParticipants: number, allParticipants: string[]) {
  // Look up if the From number is a registered user (tenant)
  try {
    const res = await sb(`/users?phone=eq.${encodeURIComponent(from)}&is_active=eq.true&limit=1`, { method: 'GET' });
    const users = await res.json();
    const tenantUser = users?.[0];

    if (!tenantUser) {
      // From is not a registered user — quarantine, can't assign tenant
      console.log(`Group message from unregistered number ${from} — skipping tenant assignment`);
      return null;
    }

    // Check if group thread already exists for this set of participants
    // Use a stable key: sorted participant list joined
    const participantKey = [...allParticipants].sort().join(',');
    const gtRes = await sb(`/group_threads?participant_key=eq.${encodeURIComponent(participantKey)}&limit=1`, { method: 'GET' });
    const existingThreads = await gtRes.json();

    let groupThreadId: string;

    if (existingThreads?.[0]) {
      groupThreadId = existingThreads[0].id;
    } else {
      // Create new group thread, owner = From user
      const createRes = await sb('/group_threads', {
        method: 'POST',
        body: JSON.stringify({
          name: `Group (${allParticipants.filter(p => p !== OUR_NUMBER).length} people)`,
          user_id: tenantUser.id,
          participants: allParticipants,
          participant_key: participantKey,
          status: 'active',
        }),
      });
      const created = await createRes.json();
      groupThreadId = created?.id;
      console.log(`New group thread created: ${groupThreadId} owned by user ${tenantUser.id} (${from})`);
    }

    // Save message to group_messages
    if (groupThreadId) {
      await sb('/group_messages', {
        method: 'POST',
        body: JSON.stringify({
          thread_id: groupThreadId,
          sender_number: from,
          body,
          direction: 'inbound',
        }),
      });
    }

    return tenantUser;
  } catch (e) {
    console.error('group message handling failed', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const from = String(form.get('From') || '');
  const to = String(form.get('To') || '');
  const body = String(form.get('Body') || '');
  const numMedia = parseInt(String(form.get('NumMedia') || '0'), 10);

  // Collect all participant numbers Twilio sends for group MMS
  // Twilio sends To as our number; group participants come via extra fields or message metadata
  // We use the presence of MessagingServiceSid or check if To !== our single number pattern
  const messagingServiceSid = form.get('MessagingServiceSid');
  
  if (!from || !body) return twiml();
  // Never process Andre's own approval replies as customer messages (prevents loops)
  if (from === ANDRE) return twiml();

  // Detect group MMS: Twilio sets NumParticipants or we can infer from MessagingServiceSid
  // A simpler heuristic: if To contains multiple numbers or from is a registered user adding our number
  // We check for group by looking at all form keys for participant numbers
  const allParticipants: string[] = [];
  form.forEach((val, key) => {
    if ((key.startsWith('To') || key === 'From') && String(val).startsWith('+')) {
      const num = String(val);
      if (!allParticipants.includes(num)) allParticipants.push(num);
    }
  });
  if (!allParticipants.includes(from)) allParticipants.push(from);
  if (!allParticipants.includes(to)) allParticipants.push(to);

  const isGroup = allParticipants.length > 2;

  if (isGroup) {
    // Handle as group thread — identify tenant from From number
    await handleGroupMessage(from, to, body, allParticipants.length, allParticipants);
    // Don't send AI draft for group messages — too noisy
    return twiml();
  }

  // --- Standard 1:1 SMS flow below ---
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
