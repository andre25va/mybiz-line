'use client';
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface Convo { number: string; lastMsg: string; lastTime: string; unread: number; }

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  if (loading) return <div className="flex justify-center py-12 text-muted text-sm">Loading…</div>;

  return (
    <div>
      <div className="px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          <input
            type="tel"
            placeholder="New message: enter number"
            value={newNum}
            onChange={e => setNewNum(e.target.value)}
            className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
          />
          <button
            disabled={!newNum}
            onClick={() => { onSelect(newNum.startsWith('+') ? newNum : `+1${newNum.replace(/\D/g,'')}`); setNewNum(''); }}
            className="bg-accent text-black text-sm font-semibold px-4 rounded-xl disabled:opacity-30 transition-colors"
          >
            Go
          </button>
        </div>
      </div>
      {!convos.length ? (
        <div className="flex flex-col items-center py-12 text-muted gap-2">
          <MessageSquare size={32} />
          <span className="text-sm">No messages yet</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {convos.map(c => (
            <div key={c.number} onClick={() => onSelect(c.number)} className="flex items-center gap-3 px-4 py-3 hover:bg-card transition-colors cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center text-lg flex-shrink-0">
                👤
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className={`font-medium text-sm ${c.unread ? 'text-white' : 'text-gray-300'}`}>{c.number}</span>
                  <span className="text-muted text-xs">{fmtTime(c.lastTime)}</span>
                </div>
                <div className="text-muted text-xs truncate">{c.lastMsg}</div>
              </div>
              {c.unread > 0 && (
                <span className="w-5 h-5 rounded-full bg-accent text-black text-xs font-bold flex items-center justify-center flex-shrink-0">{c.unread}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
