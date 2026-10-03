'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Phone, Sparkles, Calendar, CheckSquare, X, UserPlus } from 'lucide-react';

interface Msg {
  sid: string;
  from: string;
  to: string;
  body: string;
  direction: string;
  dateSent: string;
}

interface DetectedEvent {
  detected: boolean;
  title: string;
  date: string | null;
  time: string | null;
  description: string;
}

interface Props {
  number: string;
  onBack: () => void;
  onCall: (n: string) => void;
  onAddContact?: (phone: string, prefill?: { email?: string }) => void;
}

function detectContactInfo(body: string) {
  const phoneRe = /(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRe = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  const phones = Array.from(body.matchAll(phoneRe), m => m[0]);
  const emails = Array.from(body.matchAll(emailRe), m => m[0]);
  return { phones, emails, hasInfo: phones.length > 0 || emails.length > 0 };
}

export default function SMSThread({ number, onBack, onCall, onAddContact }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedEvent | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sms/history?contact=${encodeURIComponent(number)}`);
      const d = await r.json();
      const arr: Msg[] = Array.isArray(d) ? d : [];
      setMsgs(prev => {
        if (arr.length > prev.length) {
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
        return arr;
      });
    } finally {
      setLoading(false);
    }
  }, [number]);

  // Live updates — poll every 5 seconds
  useEffect(() => {
    prevCountRef.current = 0;
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

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

  const detectAI = async () => {
    // Always reload first so we analyze the very latest messages
    await load();
    const inbound = msgs.filter(m => m.direction === 'inbound').slice(-5);
    const allRecent = msgs.slice(-6);
    const combined = (inbound.length ? inbound : allRecent).map(m => m.body).join('\n');
    if (!combined.trim()) return;
    setDetecting(true);
    setDetected(null);
    const r = await fetch('/api/ai-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: combined }),
    });
    const d = await r.json();
    setDetecting(false);
    if (d.detected) setDetected(d);
    else setDetected({ detected: false, title: '', date: null, time: null, description: 'No appointment or meeting detected in recent messages.' });
  };

  const addToCalendar = () => {
    if (!detected?.detected) return;
    const title = encodeURIComponent(detected.title || `Meeting with ${number}`);
    const details = encodeURIComponent(detected.description || `From SMS with ${number}`);
    let dates = '';
    if (detected.date) {
      const d = detected.date.replace(/-/g, '');
      const t = (detected.time || '09:00').replace(':', '') + '00';
      const endHour = String((parseInt(detected.time?.split(':')[0] ?? '9') + 1)).padStart(2, '0');
      const endMin = detected.time?.split(':')[1] ?? '00';
      const endT = endHour + endMin + '00';
      dates = `&dates=${d}T${t}/${d}T${endT}`;
    }
    window.open(
      `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}${dates}&details=${details}`,
      '_blank'
    );
  };

  const addToTask = async () => {
    if (!detected?.detected) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: detected.title || `Follow up with ${number}`,
        notes: detected.description || '',
        business: 'general',
        due_date: detected.date || '',
      }),
    });
    setTaskDone(true);
    setTimeout(() => setTaskDone(false), 2500);
  };

  function fmtTime(t: string) {
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="flex flex-col h-full bg-[#f0f0f5]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0 bg-white shadow-sm">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-800 transition-colors p-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 font-semibold text-gray-900">{number}</div>
        <button
          onClick={detectAI}
          disabled={detecting || loading}
          title="AI: Detect appointment"
          className={`p-1.5 rounded-lg transition-colors ${detecting ? 'text-accent' : 'text-gray-400 hover:text-accent hover:bg-green-50'}`}
        >
          <Sparkles size={17} className={detecting ? 'animate-pulse' : ''} />
        </button>
        <button onClick={() => onCall(number)} className="text-accent hover:text-green-700 transition-colors p-1">
          <Phone size={20} />
        </button>
      </div>

      {/* AI detection banner */}
      {detected && (
        <div className={`mx-4 mt-3 border rounded-2xl p-3 ${detected.detected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-start justify-between mb-1">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className={detected.detected ? 'text-blue-500' : 'text-gray-400'} />
              <span className={`font-medium text-sm ${detected.detected ? 'text-blue-800' : 'text-gray-600'}`}>
                {detected.detected ? detected.title : 'No event detected'}
              </span>
            </div>
            <button onClick={() => setDetected(null)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          {detected.detected && detected.date && (
            <p className="text-blue-600 text-xs mb-2 ml-5">
              {new Date(detected.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {detected.time && ` at ${detected.time}`}
            </p>
          )}
          {!detected.detected && (
            <p className="text-gray-500 text-xs ml-5">{detected.description}</p>
          )}
          {detected.detected && (
            <div className="flex gap-2 ml-5 mt-2">
              <button
                onClick={addToCalendar}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium"
              >
                <Calendar size={11} /> Add to Calendar
              </button>
              <button
                onClick={addToTask}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-blue-200 text-blue-700 rounded-lg text-xs font-medium"
              >
                <CheckSquare size={11} /> {taskDone ? 'Added ✓' : 'Add to Tasks'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8 text-gray-400 text-sm">Loading…</div>
        ) : msgs.length === 0 ? (
          <div className="flex justify-center py-8 text-gray-400 text-sm">No messages yet. Say hi!</div>
        ) : (
          msgs.map(m => {
            const isMe = m.direction === 'outbound-api' || m.direction === 'outbound-reply';
            const info = !isMe ? detectContactInfo(m.body) : { phones: [], emails: [], hasInfo: false };
            return (
              <div key={m.sid} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                    isMe
                      ? 'bg-[#16a34a] text-white'           /* outbound: solid green */
                      : 'bg-white text-gray-900 shadow-sm border border-gray-200'  /* inbound: white card, clear border */
                  }`}
                >
                  <p className="text-sm leading-relaxed">{m.body}</p>
                  <p className={`text-[11px] mt-1 ${isMe ? 'text-green-200' : 'text-gray-400'}`}>
                    {fmtTime(m.dateSent)}
                  </p>
                </div>
                {/* Save to Contacts — only on inbound messages with detected phone/email */}
                {info.hasInfo && onAddContact && (
                  <button
                    onClick={() => onAddContact(info.phones[0] || number, { email: info.emails[0] })}
                    className="flex items-center gap-1 mt-1 text-xs text-accent hover:text-green-700 font-medium px-1"
                  >
                    <UserPlus size={11} /> Save to Contacts
                  </button>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0 bg-white">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Message…"
          className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="w-10 h-10 rounded-xl bg-accent disabled:opacity-30 flex items-center justify-center transition-colors hover:bg-green-700"
        >
          <Send size={16} className="text-white" />
        </button>
      </div>
    </div>
  );
}
