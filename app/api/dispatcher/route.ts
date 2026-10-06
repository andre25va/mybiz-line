// app/api/dispatcher/route.ts
// Handles inbound commands from the owner (Andre texting his own number)

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import {
  parseCommand,
  findContact,
  buildDraft,
  saveDraft,
  sendSMS,
  OWNER_NUMBER,
} from '@/lib/dispatcher';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const body = await req.json();
  const { fromPhone, messageBody } = body as {
    fromPhone: string;
    messageBody: string;
  };

  // Only owner can issue dispatcher commands
  const normalized = fromPhone.replace(/\D/g, '');
  const ownerNormalized = OWNER_NUMBER.replace(/\D/g, '');
  if (!normalized.endsWith(ownerNormalized.slice(-10))) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 });
  }

  const cmd = parseCommand(messageBody);

  // ── Follow-up intent ────────────────────────────────────────────────────────
  if (cmd.intent === 'follow_up' && cmd.contactName) {
    const contact = await findContact(userId, cmd.contactName);
    if (!contact) {
      await sendSMS(OWNER_NUMBER, `❓ Couldn't find "${cmd.contactName}" in your contacts. Check the spelling?`);
      return NextResponse.json({ ok: true });
    }

    const followUpMsg = `Hi ${contact.name.split(' ')[0]}, this is Andre's office — he saw your call. Anything urgent I can help you with?`;
    await sendSMS(contact.phone, followUpMsg);
    await sendSMS(OWNER_NUMBER, `✅ Follow-up sent to ${contact.name} (${contact.phone}). I'll notify you when they reply.`);

    await fetch(`${supabaseUrl}/rest/v1/biz_messages`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        contact_phone: contact.phone,
        body: followUpMsg,
        direction: 'outbound',
        source: 'dispatcher',
      }),
    });

    return NextResponse.json({ ok: true });
  }

  // ── Choice selection (1–4) ──────────────────────────────────────────────────
  if (cmd.intent === 'send_info' && cmd.choiceNumber) {
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/dispatcher_sessions?user_id=eq.${userId}&status=eq.awaiting_choice&order=created_at.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const [dispSession] = await sessionRes.json().catch(() => []);

    if (!dispSession) {
      await sendSMS(OWNER_NUMBER, `❓ No active conversation waiting for a choice. Try texting a contact name to start.`);
      return NextResponse.json({ ok: true });
    }

    const contact = { name: dispSession.contact_name, phone: dispSession.contact_phone, business: dispSession.contact_business };

    if (cmd.choiceNumber === 4) {
      await sendSMS(OWNER_NUMBER, `✏️ Type your custom message and I'll send it to ${contact.name} for your approval.`);
      await fetch(`${supabaseUrl}/rest/v1/dispatcher_sessions?id=eq.${dispSession.id}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'awaiting_custom' }),
      });
      return NextResponse.json({ ok: true });
    }

    const draft = await buildDraft(userId, contact, cmd.choiceNumber);
    const draftId = await saveDraft(userId, contact.phone, draft);

    await sendSMS(
      OWNER_NUMBER,
      `📝 Draft for ${contact.name}:\n"${draft}"\n\nReply ✅ to send, ✏️ to edit, or ❌ to cancel.`
    );

    await fetch(`${supabaseUrl}/rest/v1/dispatcher_sessions?id=eq.${dispSession.id}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'awaiting_approval', draft_id: draftId }),
    });

    return NextResponse.json({ ok: true });
  }

  // ── Approve draft ───────────────────────────────────────────────────────────
  if (cmd.intent === 'approve_draft') {
    const draftRes = await fetch(
      `${supabaseUrl}/rest/v1/dispatcher_drafts?user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const [draft] = await draftRes.json().catch(() => []);
    if (!draft) {
      await sendSMS(OWNER_NUMBER, `❓ No pending draft to approve.`);
      return NextResponse.json({ ok: true });
    }

    await sendSMS(draft.to_phone, draft.draft);
    await fetch(`${supabaseUrl}/rest/v1/dispatcher_drafts?id=eq.${draft.id}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    });
    await sendSMS(OWNER_NUMBER, `✅ Sent!`);
    return NextResponse.json({ ok: true });
  }

  // ── Reject draft ────────────────────────────────────────────────────────────
  if (cmd.intent === 'reject_draft') {
    await fetch(`${supabaseUrl}/rest/v1/dispatcher_drafts?user_id=eq.${userId}&status=eq.pending`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    await sendSMS(OWNER_NUMBER, `❌ Draft cancelled. Nothing was sent.`);
    return NextResponse.json({ ok: true });
  }

  await sendSMS(
    OWNER_NUMBER,
    `🤖 AI Dispatcher here. Try:\n• "Follow up with [Name]"\n• Reply 1–4 to pick an option\n• ✅ to approve or ❌ to cancel a draft`
  );
  return NextResponse.json({ ok: true });
}
