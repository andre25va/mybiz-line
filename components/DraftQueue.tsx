'use client';
import { useCallback, useEffect, useState } from 'react';

interface Draft { id: string; from_number: string; original_message: string; draft_text: string; created_at: string; }
interface Props { contacts?: { name: string; phone: string }[]; onChange?: (count: number) => void; }

const d10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

export default function DraftQueue({ contacts = [], onChange }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/drafts');
      const d = await r.json();
      const list = Array.isArray(d) ? d : [];
      setDrafts(list);
      onChange?.(list.length);
    } catch {}
    setLoading(false);
  }, [onChange]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'send' | 'skip', customText?: string) => {
    setBusy(id); setError('');
    try {
      const r = await fetch('/api/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, customText }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      setEditId(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed');
    }
    setBusy(null);
  };

  const nameFor = (num: string) => contacts.find(c => d10(c.phone) === d10(num))?.name || num;

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;
  if (!drafts.length) return <div className="flex justify-center py-12 text-gray-400 text-sm">No pending drafts</div>;

  return (
    <div className="px-4 py-3 space-y-3">
      {error && <div className="text-sm text-red-500">{error}</div>}
      {drafts.map(d => (
        <div key={d.id} className="bg-white border border-gray-200 rounded-2xl p-3 space-y-2">
          <div className="text-xs text-gray-500">From <span className="font-semibold text-gray-800">{nameFor(d.from_number)}</span></div>
          <div className="text-sm text-gray-900 bg-gray-50 rounded-xl px-3 py-2">{d.original_message}</div>
          <div className="text-xs font-semibold text-blue-600">AI draft</div>
          {editId === d.id ? (
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <div className="text-sm text-gray-900 bg-blue-50 rounded-xl px-3 py-2">{d.draft_text}</div>
          )}
          <div className="flex gap-2">
            {editId === d.id ? (
              <button data-action="draft-send-edited" disabled={busy === d.id || !editText.trim()} onClick={() => act(d.id, 'send', editText)} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium disabled:opacity-50">✅ Send edited</button>
            ) : (
              <>
                <button data-action="draft-send" disabled={busy === d.id} onClick={() => act(d.id, 'send')} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium disabled:opacity-50">✅ Send</button>
                <button data-action="draft-edit" disabled={busy === d.id} onClick={() => { setEditId(d.id); setEditText(d.draft_text); }} className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-800 text-sm font-medium">✏️ Edit</button>
              </>
            )}
            <button data-action="draft-skip" disabled={busy === d.id} onClick={() => (editId === d.id ? setEditId(null) : act(d.id, 'skip'))} className="flex-1 py-2 rounded-xl bg-gray-100 text-red-500 text-sm font-medium">{editId === d.id ? 'Cancel' : '❌ Skip'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
