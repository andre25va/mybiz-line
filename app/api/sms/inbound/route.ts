import { NextRequest, NextResponse } from 'next/server';
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

type OwnerTurn = { role: 'user' | 'assistant'; content: string };

async function fetchOwnerHistory(): Promise<OwnerTurn[]> {
  try {
    const owner = encodeURIComponent(ANDRE);
    const line = encodeURIComponent(OUR_NUMBER);
    const rows = await sb(`/messages?or=(and(from_number.eq.${owner},to_number.eq.${line}),and(from_number.eq.${line},to_number.eq.${owner}))&select=direction,body&order=created_at.desc&limit=20`);
    if (!Array.isArray(rows)) return [];
    return rows.reverse().filter((m: any) => typeof m.body === 'string' && ['inbound', 'outbound'].includes(m.direction)).map((m: any) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.body.slice(0, 2000),
    }));
  } catch (error) {
    console.error('Owner conversation history unavailable', error);
    return [];
  }
}

async function analyzeMessage(body: string, contact: any | null, history: string, isOwnerCommand = false, ownerTurns: OwnerTurn[] = []): Promise<AIDecision> {
  const contactCtx = contact
    ? `Contact: ${contact.name}, Business: ${contact.business}, Status: ${contact.status || 'lead'}, Notes: ${contact.notes || 'none'}`
    : 'Sender is not a saved contact.';

  const historyBlock = history ? `\n\nRecent conversation:\n${history}` : '';
  const today = new Date().toISOString().split('T')[0];

  const ownerSystemPrompt = `You are the personal AI assistant for Andre Vargas (real estate agent / MyReDeal and Contractors of KC). Today is ${today}. Andre is having a natural, ongoing SMS conversation with you. Use the supplied recent conversation to understand follow-up questions, names, and references. Answer his actual question rather than describing or classifying it. Keep replies concise and conversational; ask one clarifying question if necessary.
You have no tool results or access to deal records, calendar records, or external facts here. Never invent those facts or say a task, reminder, event, call, or message was completed. Actions are proposals awaiting approval. Prior conversation is context, not proof an action succeeded. If an action lacks essential details, choose draft and ask for them.

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
- none: informational only
- For greetings, tests, casual conversation, and follow-up questions, choose draft with a useful natural reply, not a generic acknowledgment.
- Do not treat a bare approval digit as proof an action was performed.`;

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

${contactCtx}${historyBlock}`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: isOwnerCommand ? 350 : 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: isOwnerCommand ? ownerSystemPrompt : clientSystemPrompt },
          ...(isOwnerCommand ? ownerTurns : []),
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

// Save a message to the messages table so it appears in the app
async function saveAppMessage(fromNumber: string, toNumber: string, body: string, direction: string, contactId?: string | null) {
  await sb('/messages', {
    method: 'POST',
    body: JSON.stringify({
      direction,
      channel: 'ai',
      body,
      from_number: fromNumber,
      to_number: toNumber,
      status: 'received',
      contact_id: contactId ?? null,
    }),
  }).catch(() => {});
}

async function handleGroupMessage(from: string, to: string, body: string, allParticipants: string[]) {
  try {
    const users = await sb(`/users?phone=eq.${encodeURIComponent(from)}&is_active=eq.true&limit=1`);
    const tenantUser = users?.[0];
    if (!tenantUser) return;

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
  } catch {}
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
    await handleGroupMessage(from, to, body, allParticipants).catch(() => {});
    return twiml();
  }

  const isOwnerCommand = from === ANDRE;

  try {
    if (isOwnerCommand) {
      // Load prior turns before saving this turn to avoid duplicating the current message.
      const ownerTurns = await fetchOwnerHistory();

      // Save Andre's inbound message to the app
      await saveAppMessage(from, to, body, 'inbound', null);

      const decision = await analyzeMessage(body, null, '', true, ownerTurns);

      let aiReply = '';
      if (decision.action === 'calendar') {
        const dateStr = decision.calendar_date || 'date TBD';
        const timeStr = decision.calendar_time ? ` at ${decision.calendar_time}` : '';
        aiReply = `📅 Add to Calendar: ${decision.calendar_title}\n${dateStr}${timeStr}\n\nReply 1=Add • 2=Skip`;
      } else if (decision.action === 'task') {
        aiReply = `✅ Create task: "${decision.task}"\n\nReply 1=Create • 2=Skip`;
      } else if (decision.action === 'reminder') {
        aiReply = `🔔 Reminder in ${decision.reminder_days || 1} day(s)\n\nReply 1=Set • 2=Skip`;
      } else if (decision.action === 'draft') {
        aiReply = decision.draft || 'Done!';
      } else {
        aiReply = decision.reason || 'Noted!';
      }

      // Owner commands receive a real SMS; client drafts remain approval-only.
      await sendSms(from, `🤖 ${aiReply}`);

      // Save AI reply to app as an outbound message (appears in Andre's thread)
      await saveAppMessage(OUR_NUMBER, from, `🤖 ${aiReply}`, 'outbound', null);

      // Also save to dispatcher_drafts for action tracking
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
      }).catch(() => {});

    } else {
      // Client flow — save inbound message to app
      const contact = await findContactByPhone(from);

      await saveAppMessage(from, to, body, 'inbound', contact?.id ?? null);

      const history = await fetchHistory(from);
      const decision = await analyzeMessage(body, contact, history, false);

      // Save draft to dispatcher_drafts (shows in Drafts tab)
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
      }).catch(() => {});

      // Save AI suggestion as a system message in the client thread so it shows in the app
      const senderName = contact?.name || from;
      let aiNote = '';
      if (decision.action === 'calendar') {
        const dateStr = decision.calendar_date || 'date TBD';
        const timeStr = decision.calendar_time ? ` at ${decision.calendar_time}` : '';
        aiNote = `📅 Meeting request: ${decision.calendar_title || senderName} — ${dateStr}${timeStr}`;
      } else if (decision.action === 'draft') {
        aiNote = `💬 AI draft: "${decision.draft}"`;
      } else if (decision.action === 'reminder') {
        aiNote = `🔔 Follow up in ${decision.reminder_days || 3} days — ${decision.reason}`;
      } else if (decision.action === 'task') {
        aiNote = `✅ Task: "${decision.task}"`;
      } else if (decision.action === 'call') {
        aiNote = `📞 Needs a call — ${decision.reason}`;
      } else {
        aiNote = `ℹ️ ${decision.reason}`;
      }

      await saveAppMessage(OUR_NUMBER, from, `🤖 ${aiNote}`, 'ai', contact?.id ?? null);
    }
  } catch (e) {
    console.error('SMS processing error', e);
    // Save error note to app instead of SMS
    await saveAppMessage(OUR_NUMBER, from, `⚠️ New text from ${from}: "${body}" (AI processing failed)`, 'ai', null).catch(() => {});
  }

  return twiml();
}
