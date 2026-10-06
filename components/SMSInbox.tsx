'use client';
import { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Search, X } from 'lucide-react';
import { buildUniquePhoneMap, matchPhone } from '@/lib/contact-phone';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const BIZ_COLORS: Record<string, string> = {
  'myredeal': '#16a34a',
  'contractors-kc': '#ea580c',
  'personal': '#374151',
};

interface Convo {
  number: string;
  lastMsg: string;
  lastTime: string;
  unread: number;
  lastDirection: 'inbound' | 'outbound';
}

interface SearchResult {
  sid: string;
  contact: string;
  body: string;
  direction: 'inbound' | 'outbound';
  dateSent: string;
}

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

function highlight(text: string, q: string) {
  if (!q) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </span>
  );
}

interface Props {
  onSelect: (n: string) => void;
  contacts?: any[];
  refreshSignal?: number;
}

export default function SMSInbox({ onSelect, contacts = [], refreshSignal }: Props) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNum, setNewNum] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Canonical E.164 keys; duplicate phones remain ambiguous instead of selecting a random contact.
  const phoneMap = buildUniquePhoneMap(contacts);

  const load = useCallback(() => {
    fetch('/api/sms/inbox')
      .then(r => r.json())
      .then(d => { setConvos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal, load]);

  // Refresh on focus
  useEffect(() => {
    const onFocus = () => load();
    const onVisible = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Full message search with debounce
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/sms/search?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const clearSearch = () => { setSearch(''); setSearchResults(null); };

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;

  return (
    <div>
      <div className="px-4 py-3 border-b border-gray-200 bg-white space-y-2">
        {/* Search bar */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search all messages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-9 pr-8 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          {search && (
            <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        {/* New message */}
        {!search && (
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder="New message: enter number"
              value={newNum}
              onChange={e => setNewNum(e.target.value)}
              className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
            <button
              disabled={!newNum}
              onClick={() => { onSelect(newNum.startsWith('+') ? newNum : `+1${newNum.replace(/\D/g,'')}`); setNewNum(''); }}
              className="bg-blue-600 text-white text-sm font-semibold px-4 rounded-xl disabled:opacity-30 transition-colors hover:bg-blue-700"
            >
              Go
            </button>
          </div>
        )}
      </div>

      {/* Search results */}
      {search && (
        <div>
          {searching && <div className="text-center py-4 text-gray-400 text-sm">Searching…</div>}
          {!searching && searchResults !== null && (
            searchResults.length === 0
              ? <div className="flex flex-col items-center py-12 text-gray-400 gap-2"><Search size={32} /><span className="text-sm">No messages found for "{search}"</span></div>
              : <div className="divide-y divide-gray-100">
                  <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50">{searchResults.length} message{searchResults.length !== 1 ? 's' : ''} found</div>
                  {searchResults.map(r => {
                    const contact = matchPhone(phoneMap, r.contact);
                    const bizId = contact?.business || 'personal';
                    const dotColor = BIZ_COLORS[bizId] || '#374151';
                    const displayName = contact?.name || r.contact;
                    return (
                      <div
                        key={r.sid}
                        onClick={() => { clearSearch(); onSelect(r.contact); }}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer bg-white"
                      >
                        <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-semibold text-white text-sm" style={{ background: dotColor }}>
                          {contact ? contact.name.charAt(0).toUpperCase() : r.contact.slice(-4, -3) || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline">
                            <span className="font-semibold text-sm text-gray-900">{displayName}</span>
                            <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{fmtTime(r.dateSent)}</span>
                          </div>
                          <div className="text-xs mt-0.5">
                            <span className={`mr-1 ${r.direction === 'inbound' ? 'text-blue-500' : 'text-gray-400'}`}>
                              {r.direction === 'inbound' ? '← ' : '→ '}
                            </span>
                            <span className="text-gray-600">{highlight(r.body, search)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
          )}
        </div>
      )}

      {/* Normal inbox list */}
      {!search && (
        !convos.length
          ? <div className="flex flex-col items-center py-12 text-gray-400 gap-2"><MessageSquare size={32} /><span className="text-sm">No messages yet</span></div>
          : <div className="divide-y divide-gray-100">
              {convos.map(c => {
                const contact = matchPhone(phoneMap, c.number);
                const bizId = contact?.business || 'personal';
                const dotColor = BIZ_COLORS[bizId] || '#374151';
                const displayName = contact?.name || c.number;
                const needsFollowUp = c.lastDirection === 'inbound';
                return (
                  <div
                    key={c.number}
                    onClick={() => onSelect(c.number)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer bg-white"
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-white" style={{ background: dotColor }}>
                        {contact ? contact.name.charAt(0).toUpperCase() : c.number.slice(-4, -3) || '?'}
                      </div>
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
                        style={{ background: dotColor }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <span className={`font-semibold text-sm ${c.unread ? 'text-gray-900' : 'text-gray-700'}`}>{displayName}</span>
                        <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{fmtTime(c.lastTime)}</span>
                      </div>
                      <div className="text-gray-500 text-xs truncate mt-0.5">{c.lastMsg}</div>
                      {needsFollowUp && (
                        <div className="text-red-500 text-xs font-semibold mt-0.5">⚠️ Your reply needed</div>
                      )}
                    </div>
                    {c.unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{c.unread}</span>
                    )}
                  </div>
                );
              })}
            </div>
      )}
    </div>
  );
}
