/**
 * Inbox source of truth is the Twilio Messages API, not a local send log.
 *
 * Messages created with only a MessagingServiceSid (the assistant uses
 * MGe41dc3cd2772ee4f016f824a7e998e31) are not returned by
 * messages.list({ from: TWILIO_PHONE_NUMBER }). That filter matches sends
 * that set From directly — what the in-app composer does — and skips
 * messaging-service traffic even after Twilio fills in From with
 * +14647333257. Listing recent account messages and messages To the other
 * party, then keeping rows whose From/To is this number (or whose messaging
 * service is ours and From is still empty), includes those sends and the
 * history already on the account. A status callback would only see messages
 * after it was configured, and an assistant-only send endpoint would miss
 * any send that still goes through the REST API.
 */

export const DEFAULT_MESSAGING_SERVICE_SID = 'MGe41dc3cd2772ee4f016f824a7e998e31';
export const DEFAULT_BUSINESS_NUMBER = '+14647333257';

export type SmsRecord = {
  sid: string;
  from: string | null;
  to: string | null;
  body: string | null;
  direction: string | null;
  status: string | null;
  dateSent: Date | string | null;
  dateCreated: Date | string | null;
  numMedia?: string | number | null;
  messagingServiceSid?: string | null;
};

type MessageList = {
  list: (opts: { from?: string; to?: string; limit?: number }) => Promise<SmsRecord[]>;
};

export function digits(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = national(a);
  const db = national(b);
  return Boolean(da) && da === db;
}

export function displayNumber(phone: string): string {
  const d = digits(phone);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return phone;
}

export function messagingServiceSids(raw = process.env.TWILIO_MESSAGING_SERVICE_SID): string[] {
  if (raw === undefined) return [DEFAULT_MESSAGING_SERVICE_SID];
  return raw.split(/[,;\s]+/).map((sid) => sid.trim()).filter(Boolean);
}

export function businessNumber(raw = process.env.TWILIO_PHONE_NUMBER): string {
  return raw && raw.trim() ? raw.trim() : DEFAULT_BUSINESS_NUMBER;
}

export function messageTime(message: SmsRecord): Date {
  const raw = message.dateSent || message.dateCreated;
  if (!raw) return new Date(0);
  const time = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(time.getTime()) ? new Date(0) : time;
}

/** True when this message is traffic on our business number. */
export function belongsToNumber(message: SmsRecord, ourNumber: string, serviceSids: string[]): boolean {
  if (samePhone(message.from, ourNumber) || samePhone(message.to, ourNumber)) return true;
  if (!message.messagingServiceSid || !serviceSids.includes(message.messagingServiceSid)) return false;
  // Messaging-service send whose From has not been filled in yet.
  return !message.from;
}

export function otherParty(message: SmsRecord, ourNumber: string, serviceSids: string[]): string {
  if (samePhone(message.from, ourNumber)) return message.to || '';
  if (samePhone(message.to, ourNumber)) return message.from || '';
  if (message.messagingServiceSid && serviceSids.includes(message.messagingServiceSid)) return message.to || '';
  return '';
}

export function previewText(message: SmsRecord): string {
  const body = (message.body || '').trim();
  if (body) return body;
  const media = Number(message.numMedia || 0);
  return media > 0 ? 'Attachment' : '';
}

export type Conversation = {
  number: string;
  lastMsg: string;
  lastTime: string;
  unread: number;
  lastDirection: 'inbound' | 'outbound';
};

export function buildConversations(messages: SmsRecord[], ourNumber: string, serviceSids: string[]): Conversation[] {
  const byContact = new Map<string, Conversation & { time: number }>();
  const ordered = messages
    .filter((message) => belongsToNumber(message, ourNumber, serviceSids))
    .sort((a, b) => messageTime(a).getTime() - messageTime(b).getTime());

  for (const message of ordered) {
    const party = otherParty(message, ourNumber, serviceSids);
    if (!party || samePhone(party, ourNumber)) continue;
    const key = national(party);
    const inbound = message.direction === 'inbound' || samePhone(message.to, ourNumber);
    const time = messageTime(message).getTime();
    byContact.set(key, {
      number: displayNumber(party),
      lastMsg: previewText(message),
      lastTime: new Date(time).toISOString(),
      unread: inbound ? 1 : 0,
      lastDirection: inbound ? 'inbound' : 'outbound',
      time,
    });
  }

  return Array.from(byContact.values())
    .sort((a, b) => b.time - a.time)
    .map(({ time: _time, ...conversation }) => conversation);
}

export function dedupeMessages(messages: SmsRecord[]): SmsRecord[] {
  const bySid = new Map<string, SmsRecord>();
  for (const message of messages) {
    if (message?.sid) bySid.set(message.sid, message);
  }
  return Array.from(bySid.values());
}

export async function fetchNumberMessages(
  client: { messages: MessageList },
  opts: { contact?: string | null; limit?: number; ourNumber?: string; serviceSids?: string[] } = {},
): Promise<SmsRecord[]> {
  const ourNumber = opts.ourNumber || businessNumber();
  const serviceSids = opts.serviceSids || messagingServiceSids();
  const limit = opts.limit ?? 100;
  const contact = opts.contact ? displayNumber(opts.contact) : undefined;
  const query = (from?: string, to?: string, page = limit) => {
    const opts: { from?: string; to?: string; limit: number } = { limit: page };
    if (from) opts.from = from;
    if (to) opts.to = to;
    return client.messages.list(opts);
  };

  const lists = await Promise.all([
    query(ourNumber, contact),
    query(contact, ourNumber),
    // Recent account traffic. This is what surfaces messaging-service sends
    // the From filter leaves out, including ones already delivered.
    query(undefined, undefined, Math.max(limit, 200)),
    ...(contact ? [query(undefined, contact)] : []),
  ]);

  return dedupeMessages(lists.flat()).filter((message) => {
    if (!belongsToNumber(message, ourNumber, serviceSids)) return false;
    if (!contact) return true;
    return samePhone(otherParty(message, ourNumber, serviceSids), contact);
  });
}

function national(phone: string | null | undefined): string {
  const d = digits(phone);
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d;
}
