import type {
  ContactWrite,
  IntakeActionRow,
  NewAction,
  PendingDraft,
  ProcessDeps,
  StoredContact,
} from './client-intake';

type DepOptions = Pick<ProcessDeps, 'allowlist' | 'blockedPhones' | 'readMedia' | 'extractWithAi'>;

export function createIntakeDeps(options: DepOptions): ProcessDeps {
  return {
    ...options,
    listContacts,
    insertContact,
    updateContact,
    deleteContact,
    claimMessage,
    saveReply,
    releaseMessage,
    listActions,
    replaceUndoable,
    markUndone,
    getPending,
    setPending,
  };
}

async function sb(path: string, options?: RequestInit, allowMissing = false): Promise<unknown> {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const headers = new Headers(options?.headers);
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Prefer')) headers.set('Prefer', 'return=representation');
  const res = await fetch(`${url}/rest/v1${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.text();
    if (allowMissing && res.status === 404) return null;
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

async function listContacts(): Promise<StoredContact[]> {
  const data = await sb('/biz_contacts?select=id,name,phone,email,address,notes,business,tags,created_at&limit=5000', {
    headers: { Range: '0-4999' },
  });
  return asRows<StoredContact>(data).map((row) => ({ ...row, tags: row.tags || [] }));
}

async function insertContact(row: ContactWrite): Promise<StoredContact> {
  const data = await sb('/biz_contacts', { method: 'POST', body: JSON.stringify(row) });
  const saved = asRows<StoredContact>(data)[0];
  if (!saved?.id) throw new Error('Supabase did not return the new contact');
  return { ...saved, tags: saved.tags || [] };
}

async function updateContact(id: string, patch: ContactWrite): Promise<StoredContact> {
  const data = await sb(`/biz_contacts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const saved = asRows<StoredContact>(data)[0];
  if (!saved?.id) throw new Error('Supabase did not return the updated contact');
  return { ...saved, tags: saved.tags || [] };
}

async function deleteContact(id: string): Promise<void> {
  await sb(`/biz_contacts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }, true);
}

async function claimMessage(sid: string, owner: string): Promise<{ duplicate: boolean; reply: string | null }> {
  const inserted = await sb('/biz_intake_messages', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ message_sid: sid, owner_phone: owner }),
  });
  if (asRows(inserted).length > 0) return { duplicate: false, reply: null };
  const rows = asRows<{ reply_text: string | null }>(
    await sb(`/biz_intake_messages?message_sid=eq.${encodeURIComponent(sid)}&select=reply_text`),
  );
  return { duplicate: true, reply: rows[0]?.reply_text ?? null };
}

async function saveReply(sid: string, reply: string): Promise<void> {
  await sb(`/biz_intake_messages?message_sid=eq.${encodeURIComponent(sid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ reply_text: reply }),
  });
}

async function releaseMessage(sid: string): Promise<void> {
  await sb(`/biz_intake_messages?message_sid=eq.${encodeURIComponent(sid)}`, { method: 'DELETE' }, true);
}

function mapAction(row: Record<string, unknown>): IntakeActionRow {
  return {
    id: String(row.id),
    messageSid: (row.message_sid as string | null) ?? null,
    ownerPhone: String(row.owner_phone),
    contactId: (row.contact_id as string | null) ?? null,
    action: row.action as IntakeActionRow['action'],
    before: (row.before_snapshot as IntakeActionRow['before']) ?? null,
    after: (row.after_snapshot as IntakeActionRow['after']) ?? null,
    awaitingClassification: Boolean(row.awaiting_classification),
    undone: Boolean(row.undone),
    undoable: Boolean(row.undoable),
    createdAt: String(row.created_at || ''),
  };
}

async function listActions(owner: string): Promise<IntakeActionRow[]> {
  const data = await sb(
    `/biz_intake_actions?owner_phone=eq.${encodeURIComponent(owner)}&order=created_at.desc&limit=50&select=*`,
  );
  return asRows<Record<string, unknown>>(data).map(mapAction);
}

async function replaceUndoable(owner: string, actions: NewAction[]): Promise<void> {
  await sb(
    `/biz_intake_actions?owner_phone=eq.${encodeURIComponent(owner)}&undoable=eq.true`,
    { method: 'PATCH', body: JSON.stringify({ undoable: false }) },
    true,
  );
  if (!actions.length) return;
  await sb('/biz_intake_actions', {
    method: 'POST',
    body: JSON.stringify(
      actions.map((action) => ({
        message_sid: action.messageSid,
        owner_phone: action.ownerPhone,
        contact_id: action.contactId,
        action: action.action,
        before_snapshot: action.before,
        after_snapshot: action.after,
        awaiting_classification: action.awaitingClassification,
        undoable: true,
        undone: false,
      })),
    ),
  });
}

async function markUndone(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await sb(`/biz_intake_actions?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ undone: true, undoable: false, awaiting_classification: false }),
  });
}

async function getPending(owner: string): Promise<PendingDraft | null> {
  const rows = asRows<{ draft: PendingDraft }>(
    await sb(`/biz_intake_pending?owner_phone=eq.${encodeURIComponent(owner)}&select=draft`),
  );
  return rows[0]?.draft ?? null;
}

async function setPending(owner: string, draft: PendingDraft | null): Promise<void> {
  if (!draft) {
    await sb(`/biz_intake_pending?owner_phone=eq.${encodeURIComponent(owner)}`, { method: 'DELETE' }, true);
    return;
  }
  await sb('/biz_intake_pending', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ owner_phone: owner, draft, question: draft.question }),
  });
}
