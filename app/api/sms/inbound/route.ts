import { NextRequest } from 'next/server';
import { sb, findContactByPhone, sendSms, twiml } from '@/lib/sb-rest';

const ANDRE = process.env.TWILIO_FALLBACK_NUMBER || '+13129989898';
const OUR_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+14647333257';

type ActionType = 'draft' | 'reminder' | 'task' | 'call' | 'calendar' | 'none';

interface AIDecision {
  action: ActionType;
  draft?: string;
  task?: string;
  reminder_days?: number;
  calendar_title?: string;
  calendar_date?: string;
  calendar_time?: string;
  reason: string;
}

async function fetchHistory(phone: string): Promise<string> {
  try {
    const msgs = await sb(`/messages?or=(from_number.eq.${encodeURIComponent(phone)},to_number.eq.${encodeURIComponent(phone)})&order=created_at.desc&limit=10`);
    if (!Array.isArray(msgs) || !msgs.length) return '';
    return msgs.reverse().map((m: any) => `${m.direction === 'inbound' ? 'Client' : 'You'}: ${m.body}`).join('\n');
  } catch { return ''; }
}

async function callTenantAI(userId: string, contactContext: string, message: string): Promise<string> {
  try {
    const rows = await sb(`/ai_provider_settings?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    const settings = rows?.[0];
    if (!settings?.api_key) return '';

    const provider = settings.provider || 'openai';
    const model = settings.model || 'gpt-4o-mini';

    if (provider === 'openai' || provider === 'chatgpt') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.api_key}` },
        body: JSON.stringify({
          model,
          max_tokens: 150,
          messages: [
            { role: 'system', content: `You are the business owner's personal AI. Given a client context and incoming message, provide any relevant business information or context that would help craft a reply. Be brief.\n\nContact context: ${contactContext}` },
            { role: 'user', content: message },
          ],
        }),
      });
      const j = await r.json();
      return (j?.choices?.[0]?.message?.content || '').trim();
    }

    if (provider === 'anthropic' || provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: model || 'claude-3-haiku-20240307',
          max_tokens: 150,
          system: `You are the business owner's personal AI. Given a client context and incoming message, provide any relevant business information or context. Be brief.\n\nContact context: ${contactContext}`,
          messages: [{ role: 'user', content: message }],
        }),
      });
      const j = await r.json();
      return (j?.content?.[0]?.text || '').trim();
    }

    return '';
  } catch { return ''; }
}

async function analyzeMessage(body: string, contact: any | null, history: string, tenantContext: string, isOwnerCommand = false): Promise<AIDecision> {
  const contactCtx = contact
    ? `Contact: ${contact.name}, Business: ${contact.business}, Status: ${contact.status || 'lead'}, Notes: ${contact.notes || 'none'}`
    : 'Sender is not a saved contact.';

  const tenantExtra = tenantContext ? `\n\nAdditional context from your AI: ${tenantContext}` : '';
  const historyBlock = history ? `\n\nRecent conversation:\n${history}` : '';
  const today = new Date().toISOString().split('T')[0];

  const ownerSystemPrompt = `You are the personal AI assistant for Andre Vargas (real estate agent / MyReDeal and Contractors of KC). Today is ${today}. Andre is texting you directly to get things done. Analyze his message and decide the best action.

Return JSON with this exact shape:
{
  "action": "draft" | "reminder" | "task" | "call" | "calendar" | "none",
  "draft": "<reply or info to send back to Andre, only if action=draft>",
  "task": "<task description, only if action=task>",
  "reminder_days": <number, only if action=reminder>,
  "calendar_title": "<event title, only if action=calendar>",
  "calendar_date": "<YYYY-MM-DD, only if action=calendar>",
  "calendar_time": "<HH:MM 24hr, only if action=calendar, omit if time unknown>",
  "reason": "<one sentence>"
}

Guidelines:
- calendar: Andre wants to schedule a meeting, appointment, showing
- task: Andre wants to create a to-do or follow-up item
- reminder: Andre wants to be reminded about something later
- draft: Andre asked a question or needs info — answer him directly
- none: acknowledgment only`;

  const clientSystemPrompt = `You are the AI assistant for Andre Vargas (real estate/MyReDeal and Contractors of KC). Today's date is ${today}. Analyze an inbound SMS from a CLIENT and decide the best action.

Return JSON with this exact shape:
{
  "action": "draft" | "reminder" | "task" | "call" | "calendar" | "none",
  "draft": "<reply text under 300 chars, only if action=draft>",
  "task": "<task description, only if action=task>",
  "reminder_days": <number, only if action=reminder>,
  "calendar_title": "<event title, only if action=calendar>",
  "calendar_date": "<YYYY-MM-DD, only if action=calendar>",
  "calendar_time": "<HH:MM 24hr, only if action=calendar, omit if time unknown>",
  "reason": "<one sentence why you chose this action>"
}

Guidelines:
- calendar: client proposed a meeting, appointment, showing, or call at a specific time/day
- draft: client needs a quick reply (question, greeting, update request)
- reminder: client asked to follow up later
- task: client requested work (estimate, document, specific deliverable)
- call: urgent, complex, or emotional — needs real conversation
- none: informational only, no response needed

${contactCtx}${historyBlock}${tenantExtra}`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: isOwnerCommand ? ownerSystemPrompt : clientSystemPrompt },
          { role: 'user', content: body },
        ],
      }),
    });
    const j = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}');
    return {
      action: parsed.action || 'draft',
      draft: parsed.draft,
      task: parsed.task,
      reminder_days: parsed.reminder_days,
      calendar_title: parsed.calendar_title,
      calendar_date: parsed.calendar_date,
      calendar_time: parsed.calendar_time,
      reason: parsed.reason || '',
    };
  } catch {
    return { action: 'draft', draft: 'Got it!', reason: 'fallback' };
  }
}

async function handleGroupMessage(from: string, to: string, body: string, allParticipants: string[]) {
  try {
    const users = await sb(`/users?phone=eq.${encodeURIComponent(from)}&is_active=eq.true&limit=1`);
    const tenantUser = users?.[0];
    if (!tenantUser) return null;

    const participantKey = [...allParticipants].sort().join(',');
    const existingThreads = await sb(`/group_threads?participant_key=eq.${encodeURIComponent(participantKey)}&limit=1`);

    let groupThreadId: string;
    if (existingThreads?.[0]) {
      groupThreadId = existingThreads[0].id;
    } else {
      const created = await sb('/group_threads', {
        method: 'POST',
        body: JSON.stringify({
          name: `Group (${allParticipants.filter((p: string) => p !== OUR_NUMBER).length} people)`,
          user_id: tenantUser.id,
          participants: allParticipants,
          participant_key: participantKey,
          status: 'active',
        }),
      });
      groupThreadId = created?.id;
    }

    if (groupThreadId) {
      await sb('/group_messages', {
        method: 'POST',
        body: JSON.stringify({ thread_id: groupThreadId, sender_number: from, body, direction: 'inbound' }),
      });
    }
    return tenantUser;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const from = String(form.get('From') || '');
  const to = String(form.get('To') || '');
  const body = String(form.get('Body') || '');

  if (!from || !body) return twiml();

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
    await handleGroupMessage(from, to, body, allParticipants);
    return twiml();
  }

  // --- Owner command mode: Andre texting BizLine ---
  if (from === ANDRE) {
    const decision = await analyzeMessage(body, null, '', '', true);

    let confirmMsg = `🤖 Got it!\n\n`;

    if (decision.action === 'calendar') {
      const dateStr = decision.calendar_date || 'date TBD';
      const timeStr = decision.calendar_time ? ` at ${decision.calendar_time}` : '';
      confirmMsg += `📅 Add to Calendar: ${decision.calendar_title}\n${dateStr}${timeStr}\n\nReply 1=Add • 2=Skip`;
    } else if (decision.action === 'task') {
      confirmMsg += `✅ Create task: "${decision.task}"\n\nReply 1=Create • 2=Skip`;
    } else if (decision.action === 'reminder') {
      confirmMsg += `🔔 Reminder in ${decision.reminder_days || 1} day(s)\n\nReply 1=Set • 2=Skip`;
    } else if (decision.action === 'draft') {
      confirmMsg += decision.draft || 'Done!';
    } else {
      confirmMsg += decision.reason || 'Noted!';
    }

    try {
      await sb('/dispatcher_drafts', {
        method: 'POST',
        body: JSON.stringify({
          status: 'pending',
          from_number: from,
          to_number: to,
          draft_text: decision.draft || '',
          original_message: body,
          action_type: decision.action,
          action_meta: JSON.stringify({
            task: decision.task,
            reminder_days: decision.reminder_days,
            calendar_title: decision.calendar_title,
            calendar_date: decision.calendar_date,
            calendar_time: decision.calendar_time,
            reason: decision.reason,
            owner_command: true,
          }),
        }),
      });
    } catch (e) { console.error('owner draft save failed', e); }

    try {
      await sendSms(ANDRE, confirmMsg);
    } catch (e) { console.error('owner confirm sms failed', e); }

    return twiml();
  }

  // --- 1:1 SMS intelligence flow (client texts in) ---
  const contact = await findContactByPhone(from);

  // Save inbound message
  try {
    await sb('/messages', {
      method: 'POST',
      body: JSON.stringify({ direction: 'inbound', channel: 'sms', body, from_number: from, to_number: to, status: 'received', contact_id: contact?.id ?? null }),
    });
  } catch (e) { console.error('inbound save failed', e); }

  // Fetch history + tenant AI context in parallel
  const [history, tenantContext] = await Promise.all([
    fetchHistory(from),
    contact?.user_id ? callTenantAI(contact.user_id, `${contact.name}, ${contact.business}, ${contact.notes || ''}`, body) : Promise.resolve(''),
  ]);

  // GPT-4o-mini decides action
  const decision = await analyzeMessage(body, contact, history, tenantContext, false);

  // Save draft
  try {
    await sb('/dispatcher_drafts', {
      method: 'POST',
      body: JSON.stringify({
        status: 'pending',
        from_number: from,
        to_number: to,
        draft_text: decision.draft || '',
        original_message: body,
        action_type: decision.action,
        action_meta: JSON.stringify({
          task: decision.task,
          reminder_days: decision.reminder_days,
          calendar_title: decision.calendar_title,
          calendar_date: decision.calendar_date,
          calendar_time: decision.calendar_time,
          reason: decision.reason,
        }),
      }),
    });
  } catch (e) { console.error('draft save failed', e); }

  // Build smart approval SMS to Andre
  const senderName = contact?.name || from;
  let approvalMsg = `📨 ${senderName}: "${body}"\n\n`;

  if (decision.action === 'calendar') {
    const dateStr = decision.calendar_date || 'date TBD';
    const timeStr = decision.calendar_time ? ` at ${decision.calendar_time}` : '';
    approvalMsg += `📅 Meeting request: ${decision.calendar_title || senderName}\n${dateStr}${timeStr}\n\nReply 1=Add to Calendar • 2=Skip`;
  } else if (decision.action === 'draft') {
    approvalMsg += `💬 AI draft: "${decision.draft}"\n\nReply 1=Send • 2=Skip • or your own text`;
  } else if (decision.action === 'reminder') {
    approvalMsg += `🔔 Follow up in ${decision.reminder_days || 3} days\nReason: ${decision.reason}\n\nReply 1=Set reminder • 2=Skip`;
  } else if (decision.action === 'task') {
    approvalMsg += `✅ Task: "${decision.task}"\nReason: ${decision.reason}\n\nReply 1=Create task • 2=Skip`;
  } else if (decision.action === 'call') {
    approvalMsg += `📞 Needs a call\nReason: ${decision.reason}\n\nReply 1=Noted • 2=Skip`;
  } else {
    approvalMsg += `ℹ️ No action needed\nReason: ${decision.reason}`;
  }

  try {
    await sendSms(ANDRE, approvalMsg);
  } catch (e) { console.error('approval sms failed', e); }

  return twiml();
}
