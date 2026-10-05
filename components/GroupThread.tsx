'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Users, Plus, X } from 'lucide-react';

const BIZ_COLORS: Record<string, string> = {
  'myredeal': '#16a34a',
  'contractors-kc': '#ea580c',
  'personal': '#374151',
};

interface Message {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  fromName?: string;
  dateSent: string;
}

interface Member {
  phone: string;
  name?: string;
  business?: string;
}

interface GroupThread {
  id: string;
  name: string;
  business: string;
  members: Member[];
  lastMsg?: string;
  lastTime?: string;
  unread?: number;
}

interface Props {
  group: GroupThread;
  contacts: any[];
  onBack: () => void;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

export default function GroupThread({ group, contacts, onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const bizColor = BIZ_COLORS[group.business] || '#374151';

  // Build phone→contact map
  const phoneMap: Record<string, any> = {};
  for (const c of contacts) {
    phoneMap[c.phone.replace(/\D/g, '')] = c;
  }

  const load = useCallback(() => {
    fetch(`/api/groups/${group.id}/messages`)
      .then(r => r.json())
      .then(d => { setMessages(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [group.id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/groups/${group.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setBody('');
      load();
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <button data-action="group-thread-back" onClick={onBack} className="text-gray-500 hover:text-gray-700 p-1 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: bizColor }}>
          <Users size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 truncate">{group.name}</div>
          <div className="text-xs text-gray-400 truncate">
            {group.members.map(m => m.name || m.phone).join(', ')}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
        {loading && <div className="text-center text-gray-400 text-sm py-8">Loading…</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">No messages yet. Send the first one.</div>
        )}
        {messages.map(msg => {
          const isOut = msg.direction === 'outbound';
          const fromNormalized = msg.fromNumber?.replace(/\D/g, '');
          const fromContact = fromNormalized ? phoneMap[fromNormalized] : null;
          const fromName = msg.fromName || fromContact?.name || msg.fromNumber;
          return (
            <div key={msg.id} className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
              {!isOut && (
                <span className="text-xs text-gray-400 mb-1 ml-1">{fromName}</span>
              )}
              <div
                className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm ${
                  isOut
                    ? 'text-white rounded-br-sm'
                    : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
                }`}
                style={isOut ? { background: bizColor } : {}}
              >
                {msg.body}
              </div>
              <span className="text-xs text-gray-400 mt-1">{fmtTime(msg.dateSent)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex gap-2 items-end">
        <textarea
          rows={1}
          placeholder={`Message group…`}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKey}
          className="flex-1 bg-gray-100 border border-gray-200 rounded-2xl px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
          style={{ minHeight: 40, maxHeight: 120 }}
        />
        <button
          data-action="group-send"
          disabled={!body.trim() || sending}
          onClick={send}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-30 transition-opacity flex-shrink-0"
          style={{ background: bizColor }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
