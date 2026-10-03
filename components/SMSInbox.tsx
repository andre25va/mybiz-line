'use client';
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_SHORT = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: TZ })
  .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';

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
      {!convos.length ? (
        <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
          <MessageSquare size={32} />
          <span className="text-sm">No messages yet</span>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {convos.map(c => {
            const needsFollowUp = c.lastDirection === 'inbound';
            return (
              <div
                key={c.number}
                onClick={() => onSelect(c.number)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer bg-white"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold flex-shrink-0">
                  {c.number.slice(-4, -3) || '👤'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <span className={`font-semibold text-sm ${c.unread ? 'text-gray-900' : 'text-gray-700'}`}>{c.number}</span>
                    <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{fmtTime(c.lastTime)}</span>
                  </div>
                  <div className="text-gray-500 text-xs truncate mt-0.5">{c.lastMsg}</div>
                  {needsFollowUp && (
                    <div className="text-red-500 text-xs font-semibold mt-0.5">⚠️ Follow up needed</div>
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
