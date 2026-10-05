import {
  classificationReply,
  intakeReply,
  interpretExtraction,
  leadFromVCard,
  parseClassificationReply,
  removedReply,
  revertedReply,
  type Classification,
  type ReadyLead,
  type ReplyEntry,
} from './lead';
import { isAllowlisted, isBlockedClientPhone, samePhone, toE164 } from './phone';
import { isVcardContentType, parseVCards } from './vcard';

export type StoredContact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  business: string;
  tags: string[] | null;
};

export type ContactWrite = {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  business: string;
  tags: string[];
};

export type ContactSnapshot = ContactWrite;

export type IntakeActionName = 'created' | 'updated' | 'classified';

export type IntakeActionRow = {
  id: string;
  messageSid: string | null;
  ownerPhone: string;
  contactId: string | null;
  action: IntakeActionName;
  before: ContactSnapshot | null;
  after: ContactSnapshot | null;
  awaitingClassification: boolean;
  undone: boolean;
  undoable: boolean;
  createdAt: string;
};

export type NewAction = {
  messageSid: string;
  ownerPhone: string;
  contactId: string | null;
  action: IntakeActionName;
  before: ContactSnapshot | null;
  after: ContactSnapshot | null;
  awaitingClassification: boolean;
};

export type PendingDraft = {
  leads: ReadyLead[];
  confirmable: boolean;
  question: string;
};

export type InboundMedia = { contentType: string; url: string };

export type ProcessInput = {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  media: InboundMedia[];
};

export type ProcessDeps = {
  allowlist: string[];
  blockedPhones: string[];
  readMedia: (url: string) => Promise<{ mime: string; bytes: Buffer }>;
  listContacts: () => Promise<StoredContact[]>;
  insertContact: (row: ContactWrite) => Promise<StoredContact>;
  updateContact: (id: string, patch: ContactWrite) => Promise<StoredContact>;
  deleteContact: (id: string) => Promise<void>;
  claimMessage: (sid: string, owner: string) => Promise<{ duplicate: boolean; reply: string | null }>;
  saveReply: (sid: string, reply: string) => Promise<void>;
  releaseMessage: (sid: string) => Promise<void>;
  listActions: (owner: string) => Promise<IntakeActionRow[]>;
  replaceUndoable: (owner: string, actions: NewAction[]) => Promise<void>;
  markUndone: (ids: string[]) => Promise<void>;
  getPending: (owner: string) => Promise<PendingDraft | null>;
  setPending: (owner: string, draft: PendingDraft | null) => Promise<void>;
  extractWithAi: (input: { text: string; images: { base64: string; mime: string }[] }) => Promise<unknown>;
};

export function snapshotOf(row: {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  business: string;
  tags: string[] | null;
}): ContactSnapshot {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    business: row.business,
    tags: row.tags || [],
  };
}

export function toWrite(lead: ReadyLead): ContactWrite {
  return {
    name: lead.name,
    phone: toE164(lead.phone) || lead.phone,
    email: lead.email,
    address: lead.location,
    notes: lead.notes,
    business: lead.business,
    tags: lead.tags,
  };
}

export function mergeWrite(existing: StoredContact, lead: ReadyLead): ContactWrite {
  const business = lead.businessExplicit ? lead.business : existing.business || lead.business;
  return {
    name: lead.name || existing.name,
    phone: toE164(lead.phone) || existing.phone,
    email: lead.email || existing.email,
    address: lead.location || existing.address,
    notes: mergeNotes(existing.notes, lead.notes),
    business,
    tags: Array.from(new Set([...(existing.tags || []), ...lead.tags])),
  };
}

export function findMatches(contacts: StoredContact[], phone: string | null, email: string | null): StoredContact[] {
  const hits = new Map<string, StoredContact>();
  for (const contact of contacts) {
    if (phone && contact.phone && samePhone(contact.phone, phone)) hits.set(contact.id, contact);
    if (email && contact.email && contact.email.toLowerCase() === email.toLowerCase()) hits.set(contact.id, contact);
  }
  return Array.from(hits.values());
}

export async function processClientIntake(input: ProcessInput, deps: ProcessDeps): Promise<{ reply: string | null }> {
  if (!isAllowlisted(input.from, deps.allowlist)) return { reply: null };

  const owner = toE164(input.from) || input.from;
  const claim = await deps.claimMessage(input.messageSid, owner);
  if (claim.duplicate) return { reply: claim.reply };

  try {
    const reply = await handleOwnedMessage(input, owner, deps);
    await deps.saveReply(input.messageSid, reply);
    return { reply };
  } catch (err) {
    await deps.releaseMessage(input.messageSid).catch(() => undefined);
    throw err;
  }
}

async function handleOwnedMessage(input: ProcessInput, owner: string, deps: ProcessDeps): Promise<string> {
  const text = (input.body || '').trim();
  if (isUndo(text)) {
    await deps.setPending(owner, null);
    return undo(owner, deps);
  }

  const vcardMedia = input.media.filter(isVcardMedia);
  if (vcardMedia.length) {
    await deps.setPending(owner, null);
    let rawCards = '';
    try {
      for (const item of vcardMedia) {
        const file = await deps.readMedia(item.url);
        rawCards += `\n${file.bytes.toString('utf8')}`;
      }
    } catch {
      return "I couldn't download that contact card. Try sharing it again.";
    }
    const cards = parseVCards(rawCards);
    if (!cards.length) return "I couldn't read that contact card. Try sharing it again.";
    return saveVCards(cards, text, owner, input.messageSid, deps);
  }

  const pending = await deps.getPending(owner);
  if (pending?.confirmable && pending.leads.length && isYes(text)) {
    await deps.setPending(owner, null);
    return persistLeads(pending.leads, owner, input.messageSid, deps);
  }

  const actions = await deps.listActions(owner);
  const batch = actions.filter((action) => action.undoable && !action.undone);
  if (batch.some((action) => action.awaitingClassification) && text && !looksLikeNewLead(text)) {
    if (isYes(text)) {
      return 'Reply buyer, seller, or contractors (concrete, remodel, countertop), or UNDO to remove.';
    }
    const classification = parseClassificationReply(text);
    if (classification?.conflict) {
      return 'That could be Real Estate or Contractors of KC. Reply with one of those.';
    }
    if (classification && (classification.business || classification.tags.length)) {
      return applyClassification(batch, classification, owner, input.messageSid, deps);
    }
  }

  const images = await loadImages(input.media, deps);
  if (!text && !images.length) {
    return 'Send a name and phone, a screenshot, or an iPhone contact card.';
  }

  const aiText = pending
    ? `Previous unconfirmed draft:\n${JSON.stringify(pending.leads)}\nOwner reply:\n${text}`
    : text;
  const raw = await deps.extractWithAi({ text: aiText, images });
  const interpreted = interpretExtraction(raw, deps.blockedPhones);
  if (interpreted.kind === 'empty') {
    await deps.setPending(owner, null);
    return "I didn't find a client in that message. Send a name and phone, a lead email, a screenshot, or a contact card.";
  }
  if (interpreted.kind === 'clarify') {
    await deps.setPending(owner, {
      leads: interpreted.draftLeads,
      confirmable: interpreted.confirmable,
      question: interpreted.question,
    });
    return interpreted.question;
  }
  await deps.setPending(owner, null);
  return persistLeads(interpreted.leads, owner, input.messageSid, deps);
}

async function saveVCards(
  cards: ReturnType<typeof parseVCards>,
  caption: string,
  owner: string,
  messageSid: string,
  deps: ProcessDeps,
): Promise<string> {
  const leads: ReadyLead[] = [];
  const problems: string[] = [];
  for (const card of cards) {
    const result = leadFromVCard(card, caption, deps.blockedPhones);
    if (result.kind === 'lead') leads.push(result.lead);
    else problems.push(result.question);
  }
  if (!leads.length) return problems[0] || "I couldn't read that contact card.";
  const saved = await persistLeads(leads, owner, messageSid, deps);
  return problems.length ? `${saved} ${problems[0]}` : saved;
}

async function persistLeads(leads: ReadyLead[], owner: string, messageSid: string, deps: ProcessDeps): Promise<string> {
  const existing = await deps.listContacts();
  for (const lead of leads) {
    if (isBlockedClientPhone(lead.phone, deps.blockedPhones)) {
      return `I need the client's phone, not your MyBiz Line number, before I can save ${lead.name}.`;
    }
    const matches = findMatches(existing, lead.phone, lead.email);
    if (matches.length > 1) {
      const names = matches.map((match) => match.name).join(' and ');
      return `That phone and email match different contacts (${names}). Reply with the phone of the one to update.`;
    }
  }

  const entries: ReplyEntry[] = [];
  const actions: NewAction[] = [];
  for (const lead of leads) {
    const matches = findMatches(existing, lead.phone, lead.email);
    const match = matches[0];
    if (!match) {
      const row = await deps.insertContact(toWrite(lead));
      existing.push(row);
      const askType = lead.askType && (row.tags || []).length === 0;
      actions.push({
        messageSid,
        ownerPhone: owner,
        contactId: row.id,
        action: 'created',
        before: null,
        after: snapshotOf(row),
        awaitingClassification: askType,
      });
      entries.push({ mode: 'created', name: row.name, phone: row.phone, tags: replyTags(lead, row), business: row.business, askType });
      continue;
    }

    const before = snapshotOf(match);
    const patch = mergeWrite(match, lead);
    const row = await deps.updateContact(match.id, patch);
    const index = existing.findIndex((contact) => contact.id === match.id);
    if (index >= 0) existing[index] = row;
    const askType = lead.askType && (row.tags || []).length === 0;
    actions.push({
      messageSid,
      ownerPhone: owner,
      contactId: row.id,
      action: 'updated',
      before,
      after: snapshotOf(row),
      awaitingClassification: askType,
    });
    entries.push({ mode: 'updated', name: row.name, phone: row.phone, tags: replyTags(lead, row), business: row.business, askType });
  }

  await deps.replaceUndoable(owner, actions);
  return intakeReply(entries);
}

async function applyClassification(
  batch: IntakeActionRow[],
  classification: Classification,
  owner: string,
  messageSid: string,
  deps: ProcessDeps,
): Promise<string> {
  const seen = new Set<string>();
  const targets = batch.filter((action) => {
    if (!action.contactId || seen.has(action.contactId)) return false;
    seen.add(action.contactId);
    return Boolean(action.after || action.before);
  });
  if (!targets.length) return 'Reply buyer, seller, or contractors (concrete, remodel, countertop).';

  const business = classification.business || targets[0].after?.business || targets[0].before?.business || 'myredeal';
  const actions: NewAction[] = [];
  const names: string[] = [];
  for (const target of targets) {
    const current = target.after || target.before;
    if (!target.contactId || !current) continue;
    const tags = Array.from(new Set([...(current.tags || []), ...classification.tags]));
    const nextBusiness = classification.business || current.business;
    const row = await deps.updateContact(target.contactId, {
      ...current,
      tags,
      business: nextBusiness,
    });
    names.push(row.name);
    actions.push({
      messageSid,
      ownerPhone: owner,
      contactId: row.id,
      action: 'classified',
      before: current,
      after: snapshotOf(row),
      awaitingClassification: false,
    });
  }
  await deps.replaceUndoable(owner, actions);
  const removes = targets.every((target) => target.action === 'created' || target.action === 'classified');
  return classificationReply(names, classification, business, removes);
}

async function undo(owner: string, deps: ProcessDeps): Promise<string> {
  const actions = await deps.listActions(owner);
  const batch = actions.filter((action) => action.undoable && !action.undone);
  if (!batch.length) return 'Nothing to undo.';

  const contactIds = Array.from(new Set(batch.map((action) => action.contactId).filter((id): id is string => Boolean(id))));
  const names = batch.map((action) => action.after?.name || action.before?.name || '').filter(Boolean);

  if (batch.every((action) => action.action === 'classified')) {
    const creates = actions.filter(
      (action) => action.action === 'created' && action.contactId && contactIds.includes(action.contactId) && !action.undone,
    );
    const createdIds = new Set(creates.map((action) => action.contactId));
    if (creates.length && contactIds.every((id) => createdIds.has(id))) {
      for (const id of contactIds) await deps.deleteContact(id);
      await deps.markUndone([...batch.map((action) => action.id), ...creates.map((action) => action.id)]);
      return removedReply(Array.from(new Set(names)));
    }
    for (const action of batch) {
      if (action.contactId && action.before) await deps.updateContact(action.contactId, action.before);
    }
    await deps.markUndone(batch.map((action) => action.id));
    return revertedReply(Array.from(new Set(names)));
  }

  if (batch.every((action) => action.action === 'created')) {
    for (const action of batch) {
      if (action.contactId) await deps.deleteContact(action.contactId);
    }
    await deps.markUndone(batch.map((action) => action.id));
    return removedReply(Array.from(new Set(names)));
  }

  for (const action of batch) {
    if (!action.contactId) continue;
    if (action.action === 'created') await deps.deleteContact(action.contactId);
    else if (action.before) await deps.updateContact(action.contactId, action.before);
  }
  await deps.markUndone(batch.map((action) => action.id));
  if (batch.every((action) => action.action === 'updated')) return revertedReply(Array.from(new Set(names)));
  return removedReply(Array.from(new Set(names)));
}

async function loadImages(media: InboundMedia[], deps: ProcessDeps): Promise<{ base64: string; mime: string }[]> {
  const images: { base64: string; mime: string }[] = [];
  for (const item of media) {
    const ct = item.contentType.split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('image/')) continue;
    try {
      const file = await deps.readMedia(item.url);
      const mime = file.mime.startsWith('image/') ? file.mime : ct;
      images.push({ base64: file.bytes.toString('base64'), mime });
    } catch {
      throw new Error('Media fetch failed');
    }
  }
  return images.slice(0, 3);
}

function isVcardMedia(media: InboundMedia): boolean {
  return isVcardContentType(media.contentType) || /\.vcf(\?|$)/i.test(media.url);
}

function isUndo(text: string): boolean {
  return /^\s*undo[\s!.]*$/i.test(text);
}

function isYes(text: string): boolean {
  return /^\s*(yes|y|confirm|save it|save|ok|okay|correct)\s*[.!]?\s*$/i.test(text);
}

function looksLikeNewLead(text: string): boolean {
  if (text.includes('@')) return true;
  return (text.match(/\d/g) || []).length >= 7;
}

function replyTags(lead: ReadyLead, row: StoredContact): string[] {
  return lead.tags.length ? lead.tags : row.tags || [];
}

function mergeNotes(existing: string | null, incoming: string | null): string | null {
  const current = (existing || '').trim();
  const next = (incoming || '').trim();
  if (!next) return current || null;
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current}\n${next}`;
}
