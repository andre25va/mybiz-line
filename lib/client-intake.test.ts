import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findMatches,
  processClientIntake,
  type ContactWrite,
  type IntakeActionRow,
  type NewAction,
  type PendingDraft,
  type ProcessDeps,
  type StoredContact,
} from './client-intake';
import { interpretExtraction, parseClassificationReply } from './lead';

const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sample_contact.vcf'),
  'utf8',
);

const FROM = '+13129989898';

function memory(extract?: ProcessDeps['extractWithAi']) {
  const contacts: StoredContact[] = [];
  const actions: IntakeActionRow[] = [];
  const messages = new Map<string, { reply: string | null }>();
  const pending = new Map<string, PendingDraft>();
  let seq = 0;
  let aiCalls = 0;
  const deps: ProcessDeps = {
    allowlist: [FROM],
    blockedPhones: [FROM, '+14647333257'],
    readMedia: async () => {
      throw new Error('Media fetch failed');
    },
    extractWithAi: async (input) => {
      aiCalls += 1;
      if (!extract) throw new Error('AI should not be called');
      return extract(input);
    },
    listContacts: async () => contacts.map((contact) => ({ ...contact, tags: [...(contact.tags || [])] })),
    insertContact: async (row: ContactWrite) => {
      const saved: StoredContact = { ...row, id: `c${++seq}`, tags: [...row.tags] };
      contacts.push(saved);
      return saved;
    },
    updateContact: async (id, patch) => {
      const index = contacts.findIndex((contact) => contact.id === id);
      if (index < 0) throw new Error(`missing ${id}`);
      contacts[index] = { ...contacts[index], ...patch, id };
      return { ...contacts[index] };
    },
    deleteContact: async (id) => {
      const index = contacts.findIndex((contact) => contact.id === id);
      if (index >= 0) contacts.splice(index, 1);
    },
    claimMessage: async (sid) => {
      const existing = messages.get(sid);
      if (existing) return { duplicate: true, reply: existing.reply };
      messages.set(sid, { reply: null });
      return { duplicate: false, reply: null };
    },
    saveReply: async (sid, reply) => {
      messages.set(sid, { reply });
    },
    releaseMessage: async (sid) => {
      messages.delete(sid);
    },
    listActions: async () => [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    replaceUndoable: async (owner, incoming: NewAction[]) => {
      for (const action of actions) {
        if (action.ownerPhone === owner) action.undoable = false;
      }
      for (const action of incoming) {
        actions.push({
          ...action,
          id: `a${++seq}`,
          undone: false,
          undoable: true,
          createdAt: String(seq).padStart(4, '0'),
        });
      }
    },
    markUndone: async (ids) => {
      for (const action of actions) {
        if (ids.includes(action.id)) {
          action.undone = true;
          action.undoable = false;
          action.awaitingClassification = false;
        }
      }
    },
    getPending: async (owner) => pending.get(owner) || null,
    setPending: async (owner, draft) => {
      if (!draft) pending.delete(owner);
      else pending.set(owner, draft);
    },
  };
  return { deps, contacts, actions, aiCalls: () => aiCalls };
}

async function send(
  deps: ProcessDeps,
  body: string,
  extra: Partial<{ sid: string; from: string; media: ProcessDeps extends never ? never : { contentType: string; url: string }[] }> = {},
) {
  return processClientIntake(
    {
      messageSid: extra.sid || `SM${Math.random().toString(16).slice(2)}`,
      from: extra.from || FROM,
      to: '+14647333257',
      body,
      media: extra.media || [],
    },
    deps,
  );
}

test('iPhone contact card creates a client and asks for type without calling the model', async () => {
  const store = memory();
  store.deps.readMedia = async () => ({ mime: 'text/x-vcard', bytes: Buffer.from(fixture) });
  const result = await send(store.deps, '', {
    sid: 'SMCARD',
    media: [{ contentType: 'text/x-vcard', url: 'https://api.twilio.com/card.vcf' }],
  });

  assert.equal(store.aiCalls(), 0);
  assert.equal(
    result.reply,
    'Added Maria Lopez, 816-555-1234. Filed under Real Estate for now. Reply buyer, seller, or contractors, or UNDO to remove.',
  );
  assert.equal(store.contacts.length, 1);
  assert.deepEqual(store.contacts[0], {
    id: store.contacts[0].id,
    name: 'Maria Lopez',
    phone: '+18165551234',
    email: 'maria@x.com',
    address: '4521 W 91st Terrace, Overland Park, KS 66207',
    notes: 'Org: Lopez Homes\nShared from iPhone. Looking around Overland Park\nAlso: 913-555-0198',
    business: 'myredeal',
    tags: [],
  });

  const labeled = await send(store.deps, 'buyer', { sid: 'SMLABEL' });
  assert.equal(store.aiCalls(), 0);
  assert.equal(labeled.reply, 'Set Maria Lopez as buyer (Real Estate). Reply UNDO to remove.');
  assert.deepEqual(store.contacts[0].tags, ['Buyer']);
  assert.equal(store.contacts[0].business, 'myredeal');

  const undone = await send(store.deps, 'UNDO', { sid: 'SMUNDO' });
  assert.equal(undone.reply, 'Removed Maria Lopez.');
  assert.equal(store.contacts.length, 0);
  const again = await send(store.deps, 'undo', { sid: 'SMUNDO2' });
  assert.equal(again.reply, 'Nothing to undo.');
});

test('a caption on the contact card supplies the type', async () => {
  const store = memory();
  store.deps.readMedia = async () => ({ mime: 'text/vcard', bytes: Buffer.from(fixture) });
  const result = await send(store.deps, 'buyer', {
    media: [{ contentType: 'text/vcard; charset=utf-8', url: 'https://api.twilio.com/card.vcf' }],
  });
  assert.equal(result.reply, 'Added Maria Lopez, 816-555-1234, buyer. Reply UNDO to remove.');
  assert.equal(store.aiCalls(), 0);
  assert.deepEqual(store.contacts[0].tags, ['Buyer']);
});

test('multiple vCards in one message are all created', async () => {
  const raw = `${fixture}\nBEGIN:VCARD\nFN:Ken Adams\nTEL;type=CELL:+19135550199\nEMAIL:ken@example.com\nEND:VCARD\n`;
  const store = memory();
  store.deps.readMedia = async (url) => ({
    mime: 'text/x-vcard',
    bytes: Buffer.from(url.endsWith('2') ? 'BEGIN:VCARD\nFN:Ada Cole\nTEL:+18165550111\nEND:VCARD\n' : raw),
  });
  const oneFile = await send(store.deps, '', {
    sid: 'SMMULTI',
    media: [{ contentType: 'text/x-vcard', url: 'https://api.twilio.com/cards.vcf' }],
  });
  assert.match(oneFile.reply || '', /Added 2 contacts: Maria Lopez, 816-555-1234; Ken Adams, 913-555-0199/);
  assert.equal(store.contacts.length, 2);

  const twoFiles = await send(store.deps, '', {
    sid: 'SMMULTI2',
    media: [
      { contentType: 'text/vcard', url: 'https://api.twilio.com/1' },
      { contentType: 'text/x-vcard', url: 'https://api.twilio.com/2' },
    ],
  });
  assert.match(twoFiles.reply || '', /Ada Cole, 816-555-0111/);
  assert.equal(store.aiCalls(), 0);
});

test('text lead uses the model result, dedupes, and undo restores the previous record', async () => {
  const store = memory(async () => ({
    needs_clarification: false,
    contacts: [
      {
        name: 'Maria Lopez',
        phone: '816-555-1234',
        email: 'maria@x.com',
        client_type: 'buyer',
        business: 'myredeal',
        location: 'Overland Park',
        notes: 'budget 350k',
      },
    ],
  }));
  store.contacts.push({
    id: 'existing',
    name: 'Maria L',
    phone: '(816) 555-1234',
    email: null,
    address: null,
    notes: 'met at open house',
    business: 'myredeal',
    tags: ['Seller'],
  });

  const result = await send(store.deps, 'New client: Maria Lopez, 816-555-1234, maria@x.com, buyer, Overland Park, budget 350k', {
    sid: 'SMTEXT',
  });
  assert.equal(result.reply, 'Updated Maria Lopez, 816-555-1234, buyer. Reply UNDO to revert.');
  assert.equal(store.contacts.length, 1);
  assert.equal(store.contacts[0].email, 'maria@x.com');
  assert.equal(store.contacts[0].address, 'Overland Park');
  assert.match(store.contacts[0].notes || '', /met at open house/);
  assert.match(store.contacts[0].notes || '', /budget 350k/);
  assert.deepEqual(store.contacts[0].tags, ['Seller', 'Buyer']);

  const undone = await send(store.deps, 'Undo', { sid: 'SMREVERT' });
  assert.equal(undone.reply, 'Reverted Maria Lopez.');
  assert.equal(store.contacts[0].name, 'Maria L');
  assert.equal(store.contacts[0].notes, 'met at open house');
  assert.equal(store.contacts[0].email, null);
});

test('a clear new text lead gets the example confirmation', async () => {
  const store = memory(async () => ({
    needs_clarification: false,
    contacts: [
      {
        name: 'Maria Lopez',
        phone: '8165551234',
        email: 'maria@x.com',
        client_type: 'buyer',
        business: 'myredeal',
        location: 'Overland Park',
        notes: 'budget 350k',
      },
    ],
  }));
  const result = await send(store.deps, 'New client: Maria Lopez, 816-555-1234, maria@x.com, buyer, Overland Park, budget 350k');
  assert.equal(result.reply, 'Added Maria Lopez, 816-555-1234, buyer. Reply UNDO to remove.');
  assert.equal(store.contacts[0].phone, '+18165551234');
  assert.equal(store.contacts[0].business, 'myredeal');
});

test('countertop leads are filed under Contractors of KC', async () => {
  const store = memory(async () => ({
    needs_clarification: false,
    contacts: [{ name: 'Jane Doe', phone: '816-555-0100', client_type: 'countertop', business: 'contractors-kc', notes: 'quartz' }],
  }));
  const result = await send(store.deps, 'Jane Doe 816-555-0100 countertop quartz');
  assert.equal(result.reply, 'Added Jane Doe, 816-555-0100, countertop (Contractors of KC). Reply UNDO to remove.');
  assert.equal(store.contacts[0].business, 'contractors-kc');
});

test('missing a name asks instead of saving, and YES does not invent one', async () => {
  const store = memory(async () => ({
    needs_clarification: true,
    question: 'What is the client name?',
    contacts: [{ name: null, phone: '816-555-1234', email: 'maria@x.com' }],
  }));
  const result = await send(store.deps, '816-555-1234 maria@x.com', { sid: 'SMASK' });
  assert.equal(result.reply, 'What is the client name?');
  assert.equal(store.contacts.length, 0);
  const yes = await send(store.deps, 'YES', { sid: 'SMYES' });
  assert.match(yes.reply || '', /name/i);
  assert.equal(store.contacts.length, 0);
});

test('YES confirms a complete draft', async () => {
  let calls = 0;
  const store = memory(async () => {
    calls += 1;
    return {
      needs_clarification: true,
      question: 'Save Maria Lopez, 816-555-1234, buyer under Real Estate? Reply YES or send a correction.',
      contacts: [{ name: 'Maria Lopez', phone: '816-555-1234', client_type: 'buyer', business: 'myredeal' }],
    };
  });
  const first = await send(store.deps, 'maybe Maria?', { sid: 'SM1' });
  assert.match(first.reply || '', /Reply YES/);
  assert.equal(store.contacts.length, 0);
  const second = await send(store.deps, 'YES', { sid: 'SM2' });
  assert.equal(second.reply, 'Added Maria Lopez, 816-555-1234, buyer. Reply UNDO to remove.');
  assert.equal(calls, 1);
  assert.equal(store.contacts.length, 1);
});

test('conflicting businesses and blocked owner numbers are not guessed', async () => {
  const conflict = interpretExtraction(
    {
      needs_clarification: false,
      contacts: [{ name: 'Maria Lopez', phone: '816-555-1234', client_type: 'buyer', business: 'contractors-kc' }],
    },
    [FROM],
  );
  assert.equal(conflict.kind, 'clarify');

  const blocked = interpretExtraction(
    { needs_clarification: false, contacts: [{ name: 'Maria Lopez', phone: '+13129989898' }] },
    [FROM, '+14647333257'],
  );
  assert.equal(blocked.kind, 'clarify');
  if (blocked.kind === 'clarify') assert.match(blocked.question, /phone/);
});

test('phone and email matching different people asks which contact to update', async () => {
  const store = memory(async () => ({
    needs_clarification: false,
    contacts: [{ name: 'Maria Lopez', phone: '816-555-1234', email: 'maria@x.com', client_type: 'buyer', business: 'myredeal' }],
  }));
  store.contacts.push(
    { id: 'a', name: 'Ann', phone: '+18165551234', email: 'ann@x.com', address: null, notes: null, business: 'myredeal', tags: [] },
    { id: 'b', name: 'Bea', phone: '+19135550000', email: 'maria@x.com', address: null, notes: null, business: 'myredeal', tags: [] },
  );
  const result = await send(store.deps, 'lead');
  assert.match(result.reply || '', /Ann and Bea/);
  assert.equal(store.contacts.length, 2);
});

test('texts from anyone except the allowlist keep the current empty reply', async () => {
  const store = memory();
  const result = await send(store.deps, 'New client: Maria Lopez, 816-555-1234', { from: '+18165550999', sid: 'SMOTHER' });
  assert.equal(result.reply, null);
  assert.equal(store.contacts.length, 0);
  assert.equal(store.aiCalls(), 0);
});

test('a repeated Twilio message does not create a second contact', async () => {
  const store = memory(async () => ({
    needs_clarification: false,
    contacts: [{ name: 'Maria Lopez', phone: '816-555-1234', client_type: 'buyer', business: 'myredeal' }],
  }));
  const first = await send(store.deps, 'Maria Lopez 816-555-1234 buyer', { sid: 'SMSAME' });
  const second = await send(store.deps, 'Maria Lopez 816-555-1234 buyer', { sid: 'SMSAME' });
  assert.equal(second.reply, first.reply);
  assert.equal(store.contacts.length, 1);
});

test('a screenshot is passed to the vision model and a failed card download does not create a contact', async () => {
  let sawImage = false;
  const store = memory(async (input) => {
    sawImage = input.images.length === 1 && input.images[0].mime === 'image/jpeg' && input.images[0].base64.length > 0;
    return {
      needs_clarification: false,
      contacts: [{ name: 'Maria Lopez', phone: '816-555-1234', client_type: 'buyer', business: 'myredeal' }],
    };
  });
  store.deps.readMedia = async () => ({ mime: 'image/jpeg', bytes: Buffer.from('jpeg-bytes') });
  const shot = await send(store.deps, '', {
    sid: 'SMIMG',
    media: [{ contentType: 'image/jpeg', url: 'https://api.twilio.com/photo.jpg' }],
  });
  assert.equal(sawImage, true);
  assert.equal(shot.reply, 'Added Maria Lopez, 816-555-1234, buyer. Reply UNDO to remove.');

  const missed = memory();
  const failed = await send(missed.deps, '', {
    sid: 'SMBAD',
    media: [{ contentType: 'text/x-vcard', url: 'https://api.twilio.com/missing.vcf' }],
  });
  assert.match(failed.reply || '', /couldn't download/i);
  assert.equal(missed.contacts.length, 0);
});

test('classification replies stay strict', () => {
  assert.equal(parseClassificationReply('buyer')?.tags[0], 'Buyer');
  assert.equal(parseClassificationReply('contractors, countertop')?.business, 'contractors-kc');
  assert.equal(parseClassificationReply('Maria buyer'), null);
  const matches = findMatches(
    [{ id: '1', name: 'Maria', phone: '(816) 555-1234', email: 'Maria@X.com', address: null, notes: null, business: 'myredeal', tags: [] }],
    '8165551234',
    'maria@x.com',
  );
  assert.equal(matches.length, 1);
});
