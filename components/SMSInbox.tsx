'use client';
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface Convo { number: string; lastMsg: string; lastTime: string; unread: number; }

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
}

interface Props { onSelect: (n: string) => void; }

export default function SMSInbox({ onSelect }: Props) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNum, setNewNum] = useState('');

  useEffect(() => {
    fetch('/api/sms/inbox')
      .then(r => r.json())
      .then(d => { setConvos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;

  return (
    <div>
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="tel"
            placeholder="New message: enter number"
            value={newNum}
            onChange={e => setNewNum(e.target.value)}
            className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500"
          />
          <button
            disabled={!newNum}
            onClick={() => { onSelect(newNum.startsWith('+') ? newNum : `+1${newNum.replace(/\D/g,'')}`); setNewNum(''); }}
            className="bg-green-600 text-white text-sm font-semibold px-4 rounded-xl disabled:opacity-30 transition-colors hover:bg-green-700"
          >
            Go
          </button>
        </div>
      </div>
      {!convos.length ? (
        <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
          <MessageSquare size={32} />
          <span className="text-sm">No messages yet</span>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {convos.map(c => (
            <div key={c.number} onClick={() => onSelect(c.number)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer bg-white">
              <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-lg flex-shrink-0">
                👤
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className={`font-semibold text-sm ${c.unread ? 'text-gray-900' : 'text-gray-700'}`}>{c.number}</span>
                  <span className="text-gray-400 text-xs">{fmtTime(c.lastTime)}</span>
                </div>
                <div className="text-gray-500 text-xs truncate mt-0.5">{c.lastMsg}</div>
              </div>
              {c.unread > 0 && (
                <span className="w-5 h-5 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{c.unread}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
