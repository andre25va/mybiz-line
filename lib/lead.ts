import { formatDisplay, isBlockedClientPhone, national10, samePhone, toE164 } from './phone';
import type { VCard } from './vcard';

export type BusinessId = 'myredeal' | 'contractors-kc';

export const DEFAULT_BUSINESS: BusinessId = 'myredeal';

export type ReadyLead = {
  name: string;
  phone: string;
  email: string | null;
  location: string | null;
  notes: string | null;
  business: BusinessId;
  businessExplicit: boolean;
  tags: string[];
  askType: boolean;
};

export type Classification = {
  business: BusinessId | null;
  tags: string[];
  conflict: boolean;
};

type Signal = { source: string; business: BusinessId; tag?: string };

const SIGNALS: Signal[] = [
  { source: 'contractors of kc', business: 'contractors-kc' },
  { source: 'real estate', business: 'myredeal' },
  { source: 'myredeal', business: 'myredeal' },
  { source: 'andre vargas(?: team)?', business: 'myredeal' },
  { source: 'countertops?', business: 'contractors-kc', tag: 'Countertop' },
  { source: 'concrete', business: 'contractors-kc', tag: 'Concrete' },
  { source: 'remodels?|remodeling|renovations?', business: 'contractors-kc', tag: 'Renovation' },
  { source: 'decks?', business: 'contractors-kc', tag: 'Deck' },
  { source: 'buyers?|buying', business: 'myredeal', tag: 'Buyer' },
  { source: 'sellers?|selling', business: 'myredeal', tag: 'Seller' },
  { source: 'realtors?', business: 'myredeal', tag: 'Realtor' },
  { source: 'investors?', business: 'myredeal', tag: 'Investor' },
  { source: 'vendors?', business: 'contractors-kc', tag: 'Vendor' },
  { source: 'contractors?', business: 'contractors-kc' },
];

const REPLY_ONLY: Signal[] = [{ source: 'title', business: 'myredeal', tag: 'Title' }];

const BAD_NAMES = new Set(['unknown', 'n/a', 'na', 'none', 'client', 'contact', 'null', 'undefined', 'tbd']);

export function businessLabel(id: string): string {
  if (id === 'contractors-kc') return 'Contractors of KC';
  if (id === 'myredeal') return 'Real Estate';
  return id;
}

export function canonicalBusiness(value: string | null | undefined): BusinessId | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (['myredeal', 'real estate', 'realestate', 'realtor', 'andre vargas', 'andre vargas team'].includes(v)) {
    return 'myredeal';
  }
  if (['contractors-kc', 'contractors', 'contractors of kc', 'contractor', 'concrete', 'remodel', 'countertop', 'countertops'].includes(v)) {
    return 'contractors-kc';
  }
  return null;
}

export function inferSignals(text: string): Classification {
  return collectSignals(text, SIGNALS);
}

export function parseClassificationReply(text: string): Classification | null {
  const original = text.trim();
  if (!original || original.length > 80) return null;
  if (original.includes('@')) return null;
  if ((original.match(/\d/g) || []).length >= 7) return null;

  const signals = [...SIGNALS, ...REPLY_ONLY];
  const found = collectSignals(original, signals);
  if (!found.business && !found.tags.length && !found.conflict) return null;

  let stripped = original.toLowerCase();
  const ordered = [...signals].sort((a, b) => b.source.length - a.source.length);
  for (const signal of ordered) stripped = stripped.replace(new RegExp(signal.source, 'ig'), ' ');
  stripped = stripped.replace(/\b(a|an|the|yeah|yep|yes|ok|okay|its|it's|she's|shes|he's|hes|for|under|business|type|client|please|just|and|or|of|kc)\b/g, ' ');
  stripped = stripped.replace(/[^a-z]+/g, '');
  if (stripped.length > 0) return null;
  return found;
}

function collectSignals(text: string, signals: Signal[]): Classification {
  const tags: string[] = [];
  let business: BusinessId | null = null;
  let conflict = false;
  for (const signal of signals) {
    const re = new RegExp(`(?:^|[^a-z0-9])(?:${signal.source})(?=$|[^a-z0-9])`, 'i');
    if (!re.test(text)) continue;
    if (signal.tag && !tags.includes(signal.tag)) tags.push(signal.tag);
    if (business && business !== signal.business) conflict = true;
    else business = signal.business;
  }
  return { business: conflict ? null : business, tags, conflict };
}

export function parseModelJson(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

type RawContact = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  client_type?: string | null;
  business?: string | null;
  location?: string | null;
  notes?: string | null;
};

export type InterpretResult =
  | { kind: 'empty' }
  | { kind: 'clarify'; question: string; confirmable: boolean; draftLeads: ReadyLead[] }
  | { kind: 'leads'; leads: ReadyLead[] };

export function interpretExtraction(raw: unknown, blocked: string[]): InterpretResult {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let contacts: RawContact[] = Array.isArray(obj.contacts) ? (obj.contacts as RawContact[]) : [];
  if (!contacts.length && (obj.name || obj.phone)) contacts = [obj as RawContact];
  const needs = Boolean(obj.needs_clarification);
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';

  if (!contacts.length) {
    if (needs) {
      return {
        kind: 'clarify',
        question: question || "Who is the client? Reply with a name and phone.",
        confirmable: false,
        draftLeads: [],
      };
    }
    return { kind: 'empty' };
  }

  const leads: ReadyLead[] = [];
  const problems: string[] = [];
  for (const contact of contacts) {
    const built = buildLeadFromFields(contact, blocked);
    if (built.kind === 'lead') leads.push(built.lead);
    else problems.push(built.question);
  }

  if (problems.length) {
    return { kind: 'clarify', question: question || problems[0], confirmable: false, draftLeads: leads };
  }
  if (needs) {
    return { kind: 'clarify', question: question || yesQuestion(leads), confirmable: true, draftLeads: leads };
  }
  return { kind: 'leads', leads };
}

export function leadFromVCard(
  card: VCard,
  caption: string,
  blocked: string[],
): { kind: 'lead'; lead: ReadyLead } | { kind: 'clarify'; question: string } {
  const name = cleanName(card.name) || cleanName(card.org);
  const phoneRaw = card.phones.map((p) => p.value).find((p) => p && !isBlockedClientPhone(p, blocked)) || null;
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  if (!name) {
    return {
      kind: 'clarify',
      question: phone
        ? `I need a name for the contact card with ${formatDisplay(phone)}. Reply with the name.`
        : 'I could not find a name on that contact card. Reply with the name and phone.',
    };
  }
  if (!phone) {
    return { kind: 'clarify', question: `I got a card for ${name} but no phone number. Reply with their phone.` };
  }

  const email = card.emails[0]?.value?.trim() || null;
  const location = card.addresses[0]?.formatted || null;
  const captionTrim = caption.trim();
  const captionClass = captionTrim ? parseClassificationReply(captionTrim) : null;
  const noteLines: string[] = [];
  if (card.org && card.org !== name) noteLines.push(`Org: ${card.org}`);
  if (card.note) noteLines.push(card.note);
  const extraPhones = card.phones.filter((p) => !samePhone(p.value, phone)).map((p) => formatDisplay(p.value));
  const extraEmails = card.emails.slice(1).map((e) => e.value);
  if (extraPhones.length || extraEmails.length) noteLines.push(`Also: ${[...extraPhones, ...extraEmails].join(', ')}`);
  if (captionTrim && !captionClass) noteLines.push(captionTrim);

  const inferred = inferSignals([card.note, card.org, captionTrim].filter(Boolean).join('\n'));
  if (inferred.conflict || captionClass?.conflict) {
    return { kind: 'clarify', question: `${name} could be Real Estate or Contractors of KC. Reply with one.` };
  }

  const tags = unique([...(inferred.tags || []), ...(captionClass?.tags || [])]);
  const business = captionClass?.business || inferred.business || DEFAULT_BUSINESS;
  const businessExplicit = Boolean(captionClass?.business || inferred.business);
  return {
    kind: 'lead',
    lead: {
      name,
      phone,
      email,
      location,
      notes: noteLines.join('\n') || null,
      business,
      businessExplicit,
      tags,
      askType: tags.length === 0 && !businessExplicit,
    },
  };
}

function buildLeadFromFields(
  contact: RawContact,
  blocked: string[],
): { kind: 'lead'; lead: ReadyLead } | { kind: 'clarify'; question: string } {
  const name = cleanName(contact.name);
  let phoneRaw = (contact.phone || '').trim();
  if (phoneRaw && isBlockedClientPhone(phoneRaw, blocked)) phoneRaw = '';
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  const email = cleanEmail(contact.email);
  if (!name) {
    return {
      kind: 'clarify',
      question: phone
        ? `I need the client's name before I can save ${formatDisplay(phone)}. Reply with the name.`
        : "I need the client's name and phone. Example: Maria Lopez, 816-555-1234, buyer.",
    };
  }
  if (!phone || !national10(phone)) {
    return { kind: 'clarify', question: `I need a phone number for ${name} before I can save them.` };
  }

  const typeInfo = inferSignals(contact.client_type || '');
  const noteInfo = inferSignals(contact.notes || '');
  const modelBiz = canonicalBusiness(contact.business);
  const businesses = [typeInfo.business, noteInfo.business, modelBiz].filter(Boolean) as BusinessId[];
  const conflict = typeInfo.conflict || noteInfo.conflict || new Set(businesses).size > 1;
  if (conflict) {
    return { kind: 'clarify', question: `${name} could be Real Estate or Contractors of KC. Reply with which business.` };
  }

  const business = modelBiz || typeInfo.business || noteInfo.business || DEFAULT_BUSINESS;
  const businessExplicit = Boolean(modelBiz || typeInfo.business || noteInfo.business);
  const tags = unique([...typeInfo.tags, ...noteInfo.tags]);
  return {
    kind: 'lead',
    lead: {
      name,
      phone,
      email,
      location: emptyToNull(contact.location),
      notes: emptyToNull(contact.notes),
      business,
      businessExplicit,
      tags,
      askType: tags.length === 0 && !businessExplicit,
    },
  };
}

export type ReplyEntry = {
  mode: 'created' | 'updated';
  name: string;
  phone: string;
  tags: string[];
  business: string;
  askType: boolean;
};

export function intakeReply(entries: ReplyEntry[]): string {
  if (!entries.length) return 'Nothing was saved.';
  const ask = entries.some((e) => e.askType);
  const sameMode = entries.every((e) => e.mode === entries[0].mode);
  const verb = entries[0].mode === 'created' ? 'Added' : 'Updated';

  const detail = (entry: ReplyEntry) => {
    const parts = [entry.name, formatDisplay(entry.phone)];
    const type = entry.tags[0]?.toLowerCase();
    if (type && !entry.askType) parts.push(type);
    let text = parts.join(', ');
    if (!entry.askType && entry.business === 'contractors-kc') text += ' (Contractors of KC)';
    return text;
  };

  let core: string;
  if (entries.length === 1) core = `${verb} ${detail(entries[0])}.`;
  else if (sameMode) core = `${verb} ${entries.length} contacts: ${entries.map(detail).join('; ')}.`;
  else core = `${entries.map((e) => `${e.mode === 'created' ? 'Added' : 'Updated'} ${detail(e)}`).join('. ')}.`;

  if (ask) {
    const askers = entries.filter((e) => e.askType);
    const businesses = new Set(askers.map((e) => e.business));
    const undo = entries.every((e) => e.mode === 'updated') ? 'UNDO to revert.' : 'UNDO to remove.';
    if (businesses.size === 1) {
      return `${core} Filed under ${businessLabel(Array.from(businesses)[0])} for now. Reply buyer, seller, or contractors, or ${undo}`;
    }
    return `${core} Reply buyer, seller, or contractors, or ${undo}`;
  }

  const undo = entries.every((e) => e.mode === 'created')
    ? 'Reply UNDO to remove.'
    : entries.every((e) => e.mode === 'updated')
      ? 'Reply UNDO to revert.'
      : 'Reply UNDO to undo.';
  return `${core} ${undo}`;
}

export function classificationReply(names: string[], classification: Classification, business: string, removes: boolean): string {
  const who = names.length === 1 ? names[0] : `${names.length} contacts`;
  const undo = removes ? 'remove' : 'revert';
  const type = classification.tags[0]?.toLowerCase();
  if (type) return `Set ${who} as ${type} (${businessLabel(business)}). Reply UNDO to ${undo}.`;
  return `Set ${who} under ${businessLabel(business)}. Reply UNDO to ${undo}.`;
}

export function removedReply(names: string[]): string {
  if (names.length === 0) return 'Removed.';
  if (names.length === 1) return `Removed ${names[0]}.`;
  if (names.length === 2) return `Removed ${names[0]} and ${names[1]}.`;
  return `Removed ${names.length} contacts.`;
}

export function revertedReply(names: string[]): string {
  if (names.length === 1) return `Reverted ${names[0]}.`;
  return `Reverted ${names.length} contacts.`;
}

function yesQuestion(leads: ReadyLead[]): string {
  if (leads.length === 1) {
    const lead = leads[0];
    const parts = [lead.name, formatDisplay(lead.phone)];
    const type = lead.tags[0]?.toLowerCase();
    if (type) parts.push(type);
    return `Save ${parts.join(', ')} under ${businessLabel(lead.business)}? Reply YES or send a correction.`;
  }
  return `Save ${leads.length} contacts? Reply YES or send a correction.`;
}

function cleanName(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return null;
  if (BAD_NAMES.has(name.toLowerCase())) return null;
  if (!/[a-z]/i.test(name)) return null;
  return name;
}

function cleanEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().replace(/^mailto:/i, '');
  if (!email.includes('@')) return null;
  return email;
}

function emptyToNull(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return text || null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
