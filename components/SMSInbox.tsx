'use client';
import { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Bell, BellOff } from 'lucide-react';

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

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

function getWatched(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('mybiz_watched') || '{}'); } catch { return {}; }
}
function saveWatched(w: Record<string, boolean>) {
  localStorage.setItem('mybiz_watched', JSON.stringify(w));
}

interface Props {
  onSelect: (n: string) => void;
  contacts?: any[];
}

export default function SMSInbox({ onSelect, contacts = [] }: Props) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNum, setNewNum] = useState('');
  const [watched, setWatched] = useState<Record<string, boolean>>(getWatched());

  // Build phone→contact map
  const phoneMap: Record<string, any> = {};
  for (const c of contacts) {
    const normalized = c.phone.replace(/\D/g, '');
    phoneMap[normalized] = c;
  }

  const load = useCallback(() => {
    fetch('/api/sms/inbox')
      .then(r => r.json())
      .then(d => { setConvos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);

    // Refresh immediately when user returns to this tab/app
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const toggleWatch = (e: React.MouseEvent, number: string) => {
    e.stopPropagation();
    const updated = { ...watched, [number]: !watched[number] };
    if (!updated[number]) delete updated[number];
    setWatched(updated);
    saveWatched(updated);
  };

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;

  const waitingOnReply = convos.filter(c => c.lastDirection === 'inbound');
  const waitingForReply = convos.filter(c => c.lastDirection === 'outbound' && watched[c.number]);

  return (
    <div>
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
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
      </div>

      {waitingOnReply.length > 0 && (
        <div className="mx-4 mt-3 mb-1 p-3 bg-red-50 border border-red-200 rounded-2xl">
          <div className="text-xs font-semibold text-red-600 mb-1">⚠️ Your Reply Needed ({waitingOnReply.length})</div>
          <div className="text-xs text-red-500">You haven't replied to these yet</div>
        </div>
      )}

      {waitingForReply.length > 0 && (
        <div className="mx-4 mt-2 mb-1 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <div className="text-xs font-semibold text-amber-700 mb-1">🔔 Waiting for Reply ({waitingForReply.length})</div>
          <div className="text-xs text-amber-600">You're watching for replies from these contacts</div>
        </div>
      )}

      {!convos.length ? (
        <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
          <MessageSquare size={32} />
          <span className="text-sm">No messages yet</span>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {convos.map(c => {
            const normalized = c.number.replace(/\D/g, '');
            const contact = phoneMap[normalized];
            const bizId = contact?.business || 'personal';
            const dotColor = BIZ_COLORS[bizId] || '#374151';
            const displayName = contact?.name || c.number;
            const needsFollowUp = c.lastDirection === 'inbound';
            const isWatched = !!watched[c.number];
            return (
              <div
                key={c.number}
                onClick={() => onSelect(c.number)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer bg-white"
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                    {contact ? contact.name.charAt(0).toUpperCase() : c.number.slice(-4, -3) || '?'}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
                    style={{ background: dotColor }}
                    title={contact ? contact.business : 'Personal'}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <span className={`font-semibold text-sm ${c.unread ? 'text-gray-900' : 'text-gray-700'}`}>{displayName}</span>
                    <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{fmtTime(c.lastTime)}</span>
                  </div>
                  <div className="text-gray-500 text-xs truncate mt-0.5">{c.lastMsg}</div>
                  {needsFollowUp && (
                    <div className="text-red-500 text-xs font-semibold mt-0.5">⚠️ Follow up needed</div>
                  )}
                  {!needsFollowUp && isWatched && (
                    <div className="text-amber-600 text-xs font-semibold mt-0.5">🔔 Watching for reply</div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <button
                    onClick={(e) => toggleWatch(e, c.number)}
                    title={isWatched ? 'Stop watching' : 'Notify me when they reply'}
                    className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                      isWatched
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white border-gray-300 text-gray-300 hover:border-amber-400'
                    }`}
                  >
                    {isWatched ? <Bell size={12} /> : <BellOff size={12} />}
                  </button>
                  {c.unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{c.unread}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
