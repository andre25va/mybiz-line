'use client';
import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, Send, Phone } from 'lucide-react';

interface Msg {
  sid: string; from: string; to: string;
  body: string; direction: string; dateSent: string;
}

interface Props { number: string; onBack: () => void; onCall: (n: string) => void; }

export default function SMSThread({ number, onBack, onCall }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const r = await fetch(`/api/sms/history?contact=${encodeURIComponent(number)}`);
    const d = await r.json();
    setMsgs(Array.isArray(d) ? d : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [number]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: number, body: text }),
    });
    setText('');
    setSending(false);
    await load();
  };

  function fmtTime(t: string) {
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="text-muted hover:text-white transition-colors p-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 font-medium text-white">{number}</div>
        <button onClick={() => onCall(number)} className="text-accent hover:text-green-400 transition-colors p-1">
          <Phone size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8 text-muted text-sm">Loading…</div>
        ) : msgs.length === 0 ? (
          <div className="flex justify-center py-8 text-muted text-sm">No messages yet. Say hi!</div>
        ) : (
          msgs.map(m => {
            const isMe = m.direction === 'outbound-api' || m.direction === 'outbound-reply';
            return (
              <div key={m.sid} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isMe ? 'bg-accent text-black' : 'bg-card text-white border border-border'}`}>
                  <p className="text-sm">{m.body}</p>
                  <p className={`text-xs mt-1 ${isMe ? 'text-green-900' : 'text-muted'}`}>{fmtTime(m.dateSent)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Message…"
          className="flex-1 bg-card border border-border rounded-xl px-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="w-10 h-10 rounded-xl bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
        >
          <Send size={16} className="text-black" />
        </button>
      </div>
    </div>
  );
}
