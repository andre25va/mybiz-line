// lib/dispatcher.ts
// AI Dispatcher — parses owner commands, builds context-aware options, manages draft approvals

import twilio from 'twilio';

// Lazy getters — never called at module load time, only inside async functions
function getSupabaseUrl() { return process.env.NEXT_PUBLIC_SUPABASE_URL!; }
function getServiceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY!; }
function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
function getTwilioNumber() { return process.env.TWILIO_PHONE_NUMBER || '+14647333257'; }
export function getOwnerNumber() { return process.env.TWILIO_FALLBACK_NUMBER || '+13129989898'; }

export type Intent =
  | 'follow_up'
  | 'send_info'
  | 'approve_draft'
  | 'reject_draft'
  | 'edit_draft'
  | 'unknown';

export interface ParsedCommand {
  intent: Intent;
  contactName?: string;
  contactPhone?: string;
  message?: string;
  draftId?: string;
  choiceNumber?: number;
}

// ── Intent parser ────────────────────────────────────────────────────────────
export function parseCommand(body: string): ParsedCommand {
  const text = body.trim().toLowerCase();

  if (/^[1-4]$/.test(text)) return { intent: 'send_info', choiceNumber: parseInt(text) };
  if (/^(✅|yes|send it|approve)/.test(text)) return { intent: 'approve_draft' };
  if (/^(❌|no|cancel|skip)/.test(text)) return { intent: 'reject_draft' };
  if (/^(✏️|edit|change)/.test(text)) return { intent: 'edit_draft' };

  if (/follow.?up|call back|reach out|check.?in/i.test(body)) {
    const nameMatch = body.match(/(?:with|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    return { intent: 'follow_up', contactName: nameMatch?.[1] };
  }

  return { intent: 'unknown', message: body };
}

// ── Contact lookup ───────────────────────────────────────────────────────────
export async function findContact(userId: string, name: string) {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceKey();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/biz_contacts?user_id=eq.${userId}&name=ilike.*${encodeURIComponent(name)}*&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const rows = await res.json();
  return rows?.[0] ?? null;
}

// ── Build 4 options based on contact's business ──────────────────────────────
export function buildOptions(business: string): string[] {
  if (business === 'Real Estate') {
    return [
      '1️⃣ Send executed contract',
      '2️⃣ Send dates & timeline only',
      '3️⃣ Send property address + agent info',
      '4️⃣ Draft a custom reply',
    ];
  }
  if (business === 'Contractors of KC') {
    return [
      '1️⃣ Send estimate',
      '2️⃣ Send job details & timeline',
      '3️⃣ Send pricing info',
      '4️⃣ Draft a custom reply',
    ];
  }
  return [
    '1️⃣ Send contact info',
    '2️⃣ Send a quick check-in',
    '3️⃣ Schedule a call',
    '4️⃣ Draft a custom reply',
  ];
}

// ── Build draft based on choice ──────────────────────────────────────────────
export async function buildDraft(
  userId: string,
  contact: { name: string; phone: string; business: string },
  choice: number
): Promise<string> {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceKey();

  const msgsRes = await fetch(
    `${supabaseUrl}/rest/v1/biz_messages?user_id=eq.${userId}&contact_phone=eq.${encodeURIComponent(contact.phone)}&order=created_at.desc&limit=10`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const messages = await msgsRes.json().catch(() => []);

  let dealContext = '';
  if (contact.business === 'Real Estate') {
    const contactRes = await fetch(
      `${supabaseUrl}/rest/v1/biz_contacts?user_id=eq.${userId}&phone=eq.${encodeURIComponent(contact.phone)}&select=deal_tag`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const [c] = await contactRes.json().catch(() => []);
    if (c?.deal_tag) dealContext = `Deal: ${c.deal_tag}`;
  }

  const contextSummary = messages
    .map((m: { direction: string; body: string }) => `${m.direction === 'inbound' ? 'Client' : 'You'}: ${m.body}`)
    .reverse()
    .join('\n');

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional assistant drafting an SMS on behalf of Andre. Keep it short, warm, and professional. Max 160 characters.\nContact: ${contact.name}, Business: ${contact.business}. ${dealContext}\nRecent conversation:\n${contextSummary || 'No prior messages.'}`,
        },
        {
          role: 'user',
          content: getChoicePrompt(contact.business, choice),
        },
      ],
      max_tokens: 100,
    }),
  });
  const openaiData = await openaiRes.json();
  return openaiData.choices?.[0]?.message?.content?.trim() ?? 'Hey, just checking in — anything I can help with?';
}

function getChoicePrompt(business: string, choice: number): string {
  const prompts: Record<string, string[]> = {
    'Real Estate': [
      'Draft an SMS offering to send the executed contract.',
      'Draft an SMS sharing key dates and timeline.',
      'Draft an SMS sharing property address and agent info.',
      'Draft a friendly check-in SMS.',
    ],
    'Contractors of KC': [
      'Draft an SMS offering to send an estimate.',
      'Draft an SMS sharing job details and timeline.',
      'Draft an SMS sharing pricing information.',
      'Draft a friendly check-in SMS.',
    ],
  };
  const list = prompts[business] ?? [
    'Draft a brief intro SMS.',
    'Draft a friendly check-in.',
    'Draft an SMS offering to schedule a call.',
    'Draft a custom friendly message.',
  ];
  return list[choice - 1] ?? list[3];
}

// ── Save pending draft ───────────────────────────────────────────────────────
export async function saveDraft(userId: string, toPhone: string, draft: string): Promise<string> {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceKey();
  const id = crypto.randomUUID();
  await fetch(`${supabaseUrl}/rest/v1/dispatcher_drafts`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ id, user_id: userId, to_phone: toPhone, draft, status: 'pending' }),
  });
  return id;
}

// ── Send SMS via Twilio ──────────────────────────────────────────────────────
export async function sendSMS(to: string, body: string) {
  return getTwilioClient().messages.create({ from: getTwilioNumber(), to, body });
}

// ── Send options menu to owner ───────────────────────────────────────────────
export async function sendOptionsToOwner(
  contact: { name: string; phone: string; business: string },
  reason: string
) {
  const options = buildOptions(contact.business);
  const menu = [
    `📋 ${contact.name} replied: "${reason}"`,
    `What would you like to do?`,
    ...options,
  ].join('\n');
  await sendSMS(getOwnerNumber(), menu);
}

export const OWNER_NUMBER = getOwnerNumber();
