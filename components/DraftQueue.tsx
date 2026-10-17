'use client';
import { useCallback, useEffect, useState } from 'react';
import { nextDraftPollDelay, readDraftPage, type DraftRow } from '@/lib/drafts-page';

interface Props { contacts?: { name: string; phone: string }[]; onChange?: (count: number) => void; }

const d10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

export default function DraftQueue({ contacts = [], onChange }: Props) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pollDelay, setPollDelay] = useState(60_000);

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = await fetch('/api/drafts');
      if (!r.ok) {
        setPollDelay(current => nextDraftPollDelay(current, r.status >= 500));
        if (r.status >= 500) setError('Drafts temporarily unavailable');
        return;
      }
      const page = readDraftPage(await r.json());
      setPollDelay(60_000);
      setDrafts(page.items);
      setNextCursor(page.nextCursor);
      setError('');
      onChange?.(page.items.length);
    } catch {
      setPollDelay(current => nextDraftPollDelay(current, true));
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/drafts?before=${encodeURIComponent(nextCursor)}`);
      if (!r.ok) {
        setPollDelay(current => nextDraftPollDelay(current, r.status >= 500));
        if (r.status >= 500) setError('Drafts temporarily unavailable');
        return;
      }
      const page = readDraftPage(await r.json());
      setDrafts(prev => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setError('');
    } catch {
      setPollDelay(current => nextDraftPollDelay(current, true));
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (document.hidden) {
        timer = window.setTimeout(tick, pollDelay);
        return;
      }
      void load().finally(() => {
        if (!stopped) timer = window.setTimeout(tick, pollDelay);
      });
    };
    timer = window.setTimeout(tick, pollDelay);
    const onVisible = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, pollDelay]);

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

  const nameFor = (num: string | null) => contacts.find(c => d10(c.phone) === d10(num || ''))?.name || num || '';

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
      {nextCursor && (
        <button data-action="drafts-load-more" disabled={loadingMore} onClick={() => void loadMore()} className="w-full py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium disabled:opacity-50">
          {loadingMore ? 'Loading…' : 'Load older drafts'}
        </button>
      )}
    </div>
  );
}
