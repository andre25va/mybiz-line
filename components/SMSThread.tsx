'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Phone, Sparkles, Calendar, CheckSquare, X, UserPlus, Paperclip, Image, FileText, Link2, ChevronRight, LayoutTemplate, Briefcase, Bell } from 'lucide-react';

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

interface BizContact {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  business?: string;
  deal_tag?: string;
}

interface Props {
  number: string;
  onBack: () => void;
  onCall: (n: string) => void;
  onAddContact?: (phone: string, prefill?: { email?: string }) => void;
  contacts?: BizContact[];
}

function detectContactInfo(body: string) {
  const phoneRe = /(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRe = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  const phones = Array.from(body.matchAll(phoneRe), m => m[0]);
  const emails = Array.from(body.matchAll(emailRe), m => m[0]);
  return { phones, emails, hasInfo: phones.length > 0 || emails.length > 0 };
}

const BIZ_COLORS: Record<string, string> = {
  myredeal: '#16a34a',
  'contractors-kc': '#ea580c',
  personal: '#374151',
};

interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
  business?: string;
  deal_tag?: string;
}

export default function SMSThread({ number, onBack, onCall, onAddContact, contacts }: Props) {
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
  const [showContactInfo, setShowContactInfo] = useState<{ phones: string[]; emails: string[] } | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [reminderMsg, setReminderMsg] = useState('');
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderDone, setReminderDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const bizColor = BIZ_COLORS[contact?.business || ''] || '#374151';

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/sms?number=${encodeURIComponent(number)}`);
    if (r.ok) setMsgs(await r.json());
    setLoading(false);
  }, [number]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (contacts) {
      const norm = (p: string) => p.replace(/\D/g, '');
      const match = contacts.find(c => norm(c.phone) === norm(number));
      if (match) setContact(match);
    }
  }, [contacts, number]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // Refetch on focus
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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
    load();
  };

  const detectEvent = async () => {
    if (msgs.length === 0) return;
    setDetecting(true);
    const last5 = msgs.slice(-5).map(m => `${m.direction === 'inbound' ? 'Them' : 'Me'}: ${m.body}`).join('\n');
    const r = await fetch('/api/ai/detect-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: last5 }),
    });
    if (r.ok) setDetected(await r.json());
    setDetecting(false);
  };

  const addToCalendar = () => {
    if (!detected?.date) return;
    const dt = detected.time
      ? new Date(`${detected.date}T${detected.time}`)
      : new Date(`${detected.date}T12:00:00`);
    const end = new Date(dt.getTime() + 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const title = encodeURIComponent(detected.title || 'Appointment');
    const dates = `&dates=${fmt(dt)}/${fmt(end)}`;
    const details = encodeURIComponent(`Via MyBiz Line with ${number}`);
    window.open(
      `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}${dates}&details=${details}`,
      '_blank'
    );
  };

  const addToTask = async () => {
    if (!detected) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: detected.title || `Follow up with ${number}`,
        notes: detected.description,
        due_date: detected.date,
        business: contact?.business || 'personal',
      }),
    });
    setTaskDone(true);
  };

  const uploadAndSend = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('to', number);
    const r = await fetch('/api/sms/send-media', { method: 'POST', body: fd });
    if (!r.ok) alert('Upload failed');
    setUploading(false);
    load();
  };

  const saveReminder = async () => {
    if (!reminderDate || !reminderTime) return;
    setReminderSaving(true);
    const appointmentTime = new Date(`${reminderDate}T${reminderTime}`).toISOString();
    // Remind 1 hour before by default
    const reminderTime_ = new Date(new Date(`${reminderDate}T${reminderTime}`).getTime() - 60 * 60 * 1000).toISOString();
    await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_phone: number,
        contact_name: contact?.name || number,
        business: contact?.business || 'personal',
        appointment_time: appointmentTime,
        reminder_time: reminderTime_,
        message: reminderMsg || `Hi ${contact?.name || 'there'}, just a reminder about your appointment.`,
      }),
    });
    setReminderSaving(false);
    setReminderDone(true);
    setTimeout(() => { setShowReminderModal(false); setReminderDone(false); setReminderDate(''); setReminderTime(''); setReminderMsg(''); }, 1500);
  };

  const savedLinks = getSavedLinks();
  const templates = getTemplates();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <button data-action="sms-thread-back" onClick={onBack} className="text-gray-500 hover:text-gray-700 p-1 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">{contact?.name || number}</div>
          {contact?.name && <div className="text-xs text-gray-500 truncate">{number}</div>}
        </div>
        <button data-action="sms-thread-call" onClick={() => onCall(number)} className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 hover:bg-gray-200">
          <Phone size={16} />
        </button>
        <button data-action="sms-thread-detect-event" onClick={detectEvent} className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 hover:bg-gray-200" title="Detect event">
          <Sparkles size={17} className={detecting ? 'animate-pulse' : ''} />
        </button>
      </div>

      {/* Detected event banner */}
      {detected && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{detected.detected ? '📅' : '🤖'}</span>
              <span className="text-sm font-semibold text-blue-900">
                {detected.detected ? detected.title : 'AI Detection'}
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
                data-action="sms-add-to-calendar"
                onClick={addToCalendar}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium"
              >
                <Calendar size={11} /> Add to Calendar
              </button>
              <button
                data-action="sms-add-to-task"
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
              <div key={m.sid} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? 'text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                  }`}
                  style={isMe ? { backgroundColor: bizColor } : {}}
                >
                  {m.body}
                  {info.hasInfo && (
                    <button
                      data-action="sms-detect-contact-info"
                      onClick={() => setShowContactInfo(info)}
                      className="block mt-1 text-xs underline opacity-70"
                    >
                      Save contact info?
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attachment options */}
      {showAttach && (
        <div className="px-4 pb-2 flex gap-2">
          <button data-action="sms-attach-image" onClick={() => { fileInputRef.current!.accept = 'image/*'; fileInputRef.current!.click(); }} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-xl text-xs text-gray-700 font-medium border border-gray-200">
            <Image size={14} /> Photo
          </button>
          <button data-action="sms-attach-file" onClick={() => { fileInputRef.current!.accept = '.pdf,.doc,.docx,.txt'; fileInputRef.current!.click(); }} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-xl text-xs text-gray-700 font-medium border border-gray-200">
            <FileText size={14} /> File
          </button>
        </div>
      )}

      {/* Links panel */}
      {showLinks && (
        <div className="px-4 pb-2 max-h-40 overflow-y-auto">
          {savedLinks.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No saved links. Add them in Settings.</p>
          ) : (
            savedLinks.map((l, i) => (
              <button key={i} data-action="sms-insert-link" onClick={() => { setText(t => t + (t ? ' ' : '') + l.url); setShowLinks(false); }} className="flex items-center gap-2 w-full py-2 border-b border-gray-100 last:border-0 text-left">
                <Link2 size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-800 truncate">{l.name}</span>
                <ChevronRight size={12} className="text-gray-400 ml-auto" />
              </button>
            ))
          )}
        </div>
      )}

      {/* Templates panel */}
      {showTemplates && (
        <div className="px-4 pb-2 max-h-40 overflow-y-auto">
          {templates.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No templates. Add them in Settings.</p>
          ) : (
            templates.map((t, i) => (
              <button key={i} data-action="sms-insert-template" onClick={() => { setText(t.body); setShowTemplates(false); }} className="flex items-center gap-2 w-full py-2 border-b border-gray-100 last:border-0 text-left">
                <LayoutTemplate size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-800 truncate">{t.name}</span>
                <ChevronRight size={12} className="text-gray-400 ml-auto" />
              </button>
            ))
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ''; }}
      />

      {/* Input bar */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0 bg-white">
        <button
          data-action="sms-toggle-attach"
          onClick={() => { setShowAttach(a => !a); setShowLinks(false); setShowTemplates(false); }}
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
            showAttach ? 'bg-accent text-white' : 'bg-gray-100 border border-gray-200 text-gray-500 hover:text-accent hover:border-accent'
          }`}
          title="Attach"
        >
          <Paperclip size={16} />
        </button>
        <button
          data-action="sms-toggle-templates"
          onClick={() => { setShowTemplates(t => !t); setShowAttach(false); setShowLinks(false); }}
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
            showTemplates ? 'bg-blue-600 text-white' : 'bg-gray-100 border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-400'
          }`}
          title="Templates"
        >
          <LayoutTemplate size={16} />
        </button>
        <button
          data-action="sms-set-reminder"
          onClick={() => setShowReminderModal(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors bg-gray-100 border border-gray-200 text-gray-500 hover:text-purple-600 hover:border-purple-400"
          title="Set Reminder"
        >
          <Bell size={16} />
        </button>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={uploading ? 'Uploading…' : 'Message…'}
          disabled={uploading}
          className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          data-action="sms-send"
          onClick={send}
          disabled={!text.trim() || sending || uploading}
          className="w-10 h-10 rounded-xl disabled:opacity-30 flex items-center justify-center transition-colors hover:opacity-90"
          style={{ backgroundColor: bizColor }}
        >
          <Send size={16} className="text-white" />
        </button>
      </div>

      {/* Reminder Modal */}
      {showReminderModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 pb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 text-base">📅 Set Reminder</h3>
              <button data-action="reminder-modal-close" onClick={() => setShowReminderModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="text-sm text-gray-500 mb-4">For: <span className="font-medium text-gray-800">{contact?.name || number}</span></div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Appointment Date</label>
                <input type="date" value={reminderDate} onChange={e => setReminderDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Appointment Time</label>
                <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Custom message (optional)</label>
                <input type="text" value={reminderMsg} onChange={e => setReminderMsg(e.target.value)} placeholder={`Hi ${contact?.name || 'there'}, just a reminder about your appointment.`} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
            </div>
            <button
              data-action="reminder-save"
              onClick={saveReminder}
              disabled={!reminderDate || !reminderTime || reminderSaving}
              className="mt-5 w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm disabled:opacity-40"
            >
              {reminderDone ? '✓ Reminder Set!' : reminderSaving ? 'Saving…' : 'Set Reminder (SMS 1hr before)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}