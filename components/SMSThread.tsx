'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Phone, Sparkles, Calendar, CheckSquare, X, UserPlus, Paperclip, Image, FileText, Link2, ChevronRight, LayoutTemplate, Wand2 } from 'lucide-react';

interface SavedLink { name: string; url: string; }
interface Template { name: string; body: string; }

function getSavedLinks(): SavedLink[] {
  try { return JSON.parse(localStorage.getItem('mybiz_links') || '[]'); } catch { return []; }
}
function getTemplates(): Template[] {
  try { return JSON.parse(localStorage.getItem('mybiz_templates') || '[]'); } catch { return []; }
}

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

interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
  business?: string;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_SHORT = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: TZ })
  .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';

function fmtTime(t: string) {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
  if (diff < 86400000) return `${time} ${TZ_SHORT}`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
  return `${date} ${time} ${TZ_SHORT}`;
}

export default function SMSThread({ number, onBack, onCall, onAddContact }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedEvent | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [translateOn, setTranslateOn] = useState(true);
  const translateTimer = useRef<any>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [draftTranslation, setDraftTranslation] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    fetch('/api/contacts')
      .then(r => r.json())
      .then((list: any[]) => {
        if (!Array.isArray(list)) return;
        const digits = (p: string) => p.replace(/\D/g, '');
        const match = list.find(c => digits(c.phone) === digits(number));
        if (match) setContact({ name: match.name, phone: match.phone, email: match.email, business: match.business });
      })
      .catch(() => {});
  }, [number]);

  useEffect(() => {
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
    const displayName = contact?.name || number;
    const title = encodeURIComponent(detected.title || `Meeting with ${displayName}`);
    const contactLines = [];
    if (contact?.name) contactLines.push(`Contact: ${contact.name}`);
    if (contact?.phone) contactLines.push(`Phone: ${contact.phone}`);
    if (contact?.email) contactLines.push(`Email: ${contact.email}`);
    const contactBlock = contactLines.length ? contactLines.join('\n') + '\n\n' : '';
    const details = encodeURIComponent(`${contactBlock}${detected.description || `From SMS with ${displayName}`}`);
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

  const uploadAndSend = async (file: File) => {
    setUploading(true);
    setShowAttach(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/sms/upload', { method: 'POST', body: fd });
      const { url, error } = await r.json();
      if (error || !url) { alert('Upload failed: ' + (error || 'unknown')); return; }
      await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: number, body: text || '', mediaUrl: url }),
      });
      setText('');
      await load();
    } finally {
      setUploading(false);
    }
  };

  const insertLink = (link: SavedLink) => {
    setText(t => t ? `${t} ${link.url}` : link.url);
    setShowLinks(false);
    setShowAttach(false);
  };

  const insertTemplate = (tpl: Template) => {
    setText(tpl.body);
    setShowTemplates(false);
  };

  const translateMessage = async (id: string, msgText: string) => {
    if (translations[id]) { setTranslations(t => { const n = {...t}; delete n[id]; return n; }); return; }
    setTranslatingId(id);
    try {
      const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msgText, targetLang: 'English' }) });
      const d = await r.json();
      if (d.translation) setTranslations(t => ({ ...t, [id]: d.translation }));
    } catch {}
    setTranslatingId(null);
  };

  const translateDraft = async (t: string) => {
    if (!t.trim()) { setDraftTranslation(''); return; }
    try {
      const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, targetLang: 'Spanish' }) });
      const d = await r.json();
      if (d.translation) setDraftTranslation(d.translation);
    } catch {}
  };

  const generateAIReply = async () => {
    setAiLoading(true);
    setShowAttach(false);
    try {
      const recent = msgs.slice(-6).map(m => ({ role: m.direction.startsWith('outbound') ? 'assistant' : 'user', content: m.body }));
      const bizContext = contact?.business === 'contractors-kc' ? 'Contractors of KC (construction company)' : contact?.business === 'myredeal' ? 'MyReDeal (real estate)' : 'personal';
      const r = await fetch('/api/ai-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: recent, business: bizContext, contactName: contact?.name }) });
      const d = await r.json();
      if (d.reply) setText(d.reply);
    } catch {}
    setAiLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#f0f0f5]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-white shadow-sm">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-800 transition-colors p-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">{contact?.name || number}</div>
          {contact?.name && <div className="text-xs text-gray-400">{number}</div>}
        </div>
        <button
          onClick={detectAI}
          disabled={detecting || loading}
          title="AI: Detect appointment"
          className={`p-1.5 rounded-lg transition-colors ${detecting ? 'text-green-600' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
        >
          <Sparkles size={17} className={detecting ? 'animate-pulse' : ''} />
        </button>
        <button onClick={() => onCall(number)} className="text-green-600 hover:text-green-700 transition-colors p-1">
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
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isMe
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  }`}
                >
                  <p className="text-sm leading-relaxed break-words">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? 'text-green-200' : 'text-gray-400'}`}>
                    {fmtTime(m.dateSent)}
                  </p>
                </div>
                {!isMe && (
                  <button
                    onClick={() => translateMessage(m.sid, m.body)}
                    className="flex items-center gap-1 mt-1 text-xs text-purple-500 hover:text-purple-700 font-medium px-1"
                  >
                    🌐 {translations[m.sid] ? 'Hide translation' : translatingId === m.sid ? 'Translating…' : 'Translate'}
                  </button>
                )}
                {translations[m.sid] && (
                  <div className="mt-1 max-w-[75%] bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                    <p className="text-xs text-purple-400 font-semibold mb-0.5">🇺🇸 English</p>
                    <p className="text-sm text-purple-900">{translations[m.sid]}</p>
                  </div>
                )}
                {info.hasInfo && onAddContact && (
                  <button
                    onClick={() => onAddContact(info.phones[0] || number, { email: info.emails[0] })}
                    className="flex items-center gap-1 mt-1 text-xs text-green-600 hover:text-green-700 font-medium px-1"
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

      {/* Attachment menu */}
      {showAttach && (
        <div className="mx-4 mb-2 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
          <button
            onClick={() => { fileInputRef.current!.accept = 'image/*'; fileInputRef.current!.click(); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
              <Image size={16} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-900">Picture</span>
          </button>
          <button
            onClick={() => { fileInputRef.current!.accept = '.pdf,.doc,.docx,.txt'; fileInputRef.current!.click(); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
              <FileText size={16} className="text-orange-600" />
            </div>
            <span className="text-sm font-medium text-gray-900">File</span>
          </button>
          <button
            onClick={() => { setShowLinks(true); setShowAttach(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
              <Link2 size={16} className="text-green-600" />
            </div>
            <div className="flex-1 text-left">
              <span className="text-sm font-medium text-gray-900">Link</span>
              <span className="text-xs text-gray-400 ml-2">from saved links</span>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </button>
          <button
            onClick={generateAIReply}
            disabled={aiLoading}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
              <Wand2 size={16} className="text-purple-600" />
            </div>
            <span className="text-sm font-medium text-gray-900">{aiLoading ? 'Generating…' : 'AI Reply'}</span>
          </button>
          <button
            onClick={() => { setShowTemplates(t => !t); setShowAttach(false); setShowLinks(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
              <LayoutTemplate size={16} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-900 flex-1">Templates</span>
            <ChevronRight size={14} className="text-gray-300" />
          </button>
          <div className="w-full flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-xl bg-yellow-100 flex items-center justify-center text-base">🌐</div>
            <span className="text-sm font-medium text-gray-900 flex-1">Auto-Translate (MX Spanish)</span>
            <button
              onClick={(e) => { e.stopPropagation(); setTranslateOn(v => !v); }}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${translateOn ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${translateOn ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Saved links picker */}
      {showLinks && (
        <div className="mx-4 mb-2 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {getSavedLinks().length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">
              No saved links yet.<br />
              <span className="text-green-600 text-xs">Add them in Settings → Links</span>
            </div>
          ) : (
            getSavedLinks().map((link, i) => (
              <button
                key={i}
                onClick={() => insertLink(link)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 text-left"
              >
                <Link2 size={14} className="text-green-600 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{link.name}</div>
                  <div className="text-xs text-gray-400 truncate">{link.url}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Templates picker */}
      {showTemplates && (
        <div className="mx-4 mb-2 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {getTemplates().length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">
              No templates yet.<br />
              <span className="text-green-600 text-xs">Add them in Settings → Message Templates</span>
            </div>
          ) : (
            getTemplates().map((tpl, i) => (
              <button
                key={i}
                onClick={() => insertTemplate(tpl)}
                className="w-full flex flex-col px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 text-left"
              >
                <span className="text-sm font-medium text-gray-900">{tpl.name}</span>
                <span className="text-xs text-gray-400 mt-0.5 line-clamp-2">{tpl.body}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ''; }}
      />

      {/* Draft translation preview */}
      {draftTranslation && translateOn && (
        <div className="mx-4 mb-1 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
          <p className="text-xs text-purple-400 font-semibold mb-0.5">🇲🇽 Spanish (Mexico)</p>
          <p className="text-sm text-purple-900">{draftTranslation}</p>
        </div>
      )}

      {/* Input bar */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0 bg-white">
        <button
          onClick={() => { setShowAttach(a => !a); setShowLinks(false); setShowTemplates(false); }}
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
            showAttach ? 'bg-green-600 text-white' : 'bg-gray-100 border border-gray-200 text-gray-500 hover:text-green-600 hover:border-green-400'
          }`}
          title="Attach"
        >
          <Paperclip size={16} />
        </button>
        <input
          value={text}
          onChange={e => {
            setText(e.target.value);
            if (translateTimer.current) clearTimeout(translateTimer.current);
            translateTimer.current = setTimeout(() => translateOn ? translateDraft(e.target.value) : setDraftTranslation(''), 800);
          }}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={uploading ? 'Uploading…' : 'Message…'}
          disabled={uploading}
          className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending || uploading}
          className="w-10 h-10 rounded-xl bg-green-600 disabled:opacity-30 flex items-center justify-center transition-colors hover:bg-green-700"
        >
          <Send size={16} className="text-white" />
        </button>
      </div>
    </div>
  );
}
