'use client';
import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Phone, MessageSquare, X, User, Trash2, Mic, MicOff, Copy, Check, Tag, Camera, Loader2, Briefcase, MoreHorizontal, ChevronRight, AlertTriangle, Download } from 'lucide-react';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  business: string;
  tags?: string[];
  deal_tag?: string;
  created_at: string;
}

const BUSINESSES = [
  { id: 'myredeal', name: 'Real Estate', color: '#16a34a' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

const PRESET_TAGS = ['Vendor', 'Realtor', 'Countertop', 'Deck', 'Renovation', 'Investor', 'Buyer', 'Seller', 'Title'];

interface Props {
  onCall: (n: string) => void;
  onSMS: (n: string) => void;
  prefillPhone?: string;
  prefillEmail?: string;
  prefillName?: string;
  onPrefillUsed?: () => void;
}

export default function Contacts({ onCall, onSMS, prefillPhone, prefillEmail, prefillName, onPrefillUsed }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal', tags: [] as string[], deal_tag: '' });
  const [customTag, setCustomTag] = useState('');
  const [importing, setImporting] = useState(false);
  const downloadVCard = (c: Contact) => {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push('FN:' + c.name);
    const nameParts = c.name.split(' ');
    const last = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const first = nameParts.slice(0, nameParts.length > 1 ? -1 : 1).join(' ');
    lines.push('N:' + last + ';' + first + ';;;');
    lines.push('TEL;TYPE=CELL:' + c.phone);
    if (c.email) lines.push('EMAIL:' + c.email);
    if (c.address) lines.push('ADR;TYPE=HOME:;;' + c.address + ';;;;');
    if (c.notes) lines.push('NOTE:' + c.notes);
    lines.push('END:VCARD');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name.replace(/\s+/g, '_') + '.vcf';
    a.click();
    URL.revokeObjectURL(url);
    setActionSheet(null);
  };

  const [actionSheet, setActionSheet] = useState<Contact | null>(null);
  const [reminderFor, setReminderFor] = useState<Contact | null>(null);
  const [remTime, setRemTime] = useState('');
  const [remMins, setRemMins] = useState(60);
  const [remMsg, setRemMsg] = useState('');
  const [remBusy, setRemBusy] = useState(false);
  const [remStatus, setRemStatus] = useState('');

  const openReminder = (c: Contact) => {
    setActionSheet(null);
    setReminderFor(c);
    setRemTime('');
    setRemMins(60);
    setRemMsg(`Hi ${c.name.split(' ')[0]}, this is a reminder about your upcoming appointment. Reply here if you need to reschedule.`);
    setRemStatus('');
  };

  const scheduleReminder = async () => {
    if (!reminderFor || !remTime) return;
    setRemBusy(true); setRemStatus('');
    try {
      const r = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactPhone: reminderFor.phone,
          contactName: reminderFor.name,
          business: reminderFor.business,
          appointmentTime: new Date(remTime).toISOString(),
          reminderMessage: remMsg,
          reminderMinutesBefore: remMins,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setRemStatus(d.scheduled ? 'Reminder scheduled!' : 'Reminder sent now!');
      setTimeout(() => setReminderFor(null), 1200);
    } catch (e: any) {
      setRemStatus(e.message || 'Failed to schedule');
    }
    setRemBusy(false);
  };

  const [activity, setActivity] = useState<{ type: string; id: string; created_at: string; description: string }[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    if (view !== 'edit' || !editing) { setActivity([]); return; }
    let cancelled = false;
    setActivityLoading(true);
    fetch(`/api/contacts/${editing.id}/activity`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setActivity(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, [view, editing?.id]);
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [listening, setListening] = useState(false);
  const [voiceField, setVoiceField] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/contacts');
      const d = await r.json();
      setContacts(Array.isArray(d) ? d : []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (prefillPhone || prefillEmail || prefillName) {
      setForm(p => ({
        ...p,
        name: prefillName || p.name,
        phone: prefillPhone || p.phone,
        email: prefillEmail || p.email,
      }));
      setView('add');
      onPrefillUsed?.();
    }
  }, [prefillPhone, prefillEmail, prefillName]);

  const filtered = contacts.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase());
    const matchTag = !filterTag || (c.tags || []).includes(filterTag);
    return matchSearch && matchTag;
  });

  const openAdd = () => {
    setForm({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal', tags: [], deal_tag: '' });
    setEditing(null);
    setView('add');
  };

  const openEdit = (c: Contact) => {
    setActionSheet(null);
    setEditing(c);
    setForm({ name: c.name, phone: c.phone, email: c.email || '', address: c.address || '', notes: c.notes || '', business: c.business, tags: c.tags || [], deal_tag: c.deal_tag || '' });
    setView('edit');
  };

  const closeForm = () => {
    setView('list');
    setEditing(null);
    setForm({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal', tags: [], deal_tag: '' });
    setCustomTag('');
    stopVoice();
  };

  const toggleTag = (tag: string) => {
    setForm(p => ({
      ...p,
      tags: p.tags.includes(tag) ? p.tags.filter(t => t !== tag) : [...p.tags, tag],
    }));
  };

  const addCustomTag = () => {
    const t = customTag.trim();
    if (!t || form.tags.includes(t)) { setCustomTag(''); return; }
    setForm(p => ({ ...p, tags: [...p.tags, t] }));
    setCustomTag('');
  };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch(editing ? `/api/contacts?id=${editing.id}` : '/api/contacts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        let message = 'Could not save contact. Please try again.';
        try {
          const data = await response.json();
          if (typeof data.error === 'string' && data.error.trim()) message = data.error;
        } catch { /* Use the fallback message when the response has no JSON body. */ }
        throw new Error(message);
      }
      closeForm();
      void load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save contact. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const del = async (contact: Contact) => {
    setDeleting(true);
    await fetch(`/api/contacts?id=${contact.id}`, { method: 'DELETE' });
    setDeleting(false);
    setConfirmDelete(null);
    setActionSheet(null);
    closeForm();
    load();
  };

  const copyContact = async (c: Contact) => {
    const parts = [c.name, c.phone, c.email].filter(Boolean);
    await navigator.clipboard.writeText(parts.join('\n'));
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleScreenshotImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/contacts/import-screenshot', { method: 'POST', body: fd });
      const data = await res.json();
      setForm({
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        notes: data.notes || '',
        business: 'myredeal',
        tags: [],
        deal_tag: '',
      });
      setEditing(null);
      setView('add');
    } catch {
      alert('Could not read the screenshot. Try a clearer image.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startVoice = (field: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice input not supported on this browser.'); return; }
    stopVoice();
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.trim();
      setForm(p => ({ ...p, [field]: transcript }));
      setListening(false);
      setVoiceField(null);
    };
    rec.onerror = () => { setListening(false); setVoiceField(null); };
    rec.onend = () => { setListening(false); setVoiceField(null); };
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
    setVoiceField(field);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setListening(false);
    setVoiceField(null);
  };

  const FIELDS = [
    { label: 'Name *', key: 'name', type: 'text', placeholder: 'Full name', voice: true },
    { label: 'Phone *', key: 'phone', type: 'tel', placeholder: '+1 (555) 000-0000', voice: true },
    { label: 'Email', key: 'email', type: 'email', placeholder: 'email@example.com', voice: true },
    { label: 'Address', key: 'address', type: 'text', placeholder: '123 Main St, City, ST', voice: true },
  ];

  const allUsedTags = Array.from(new Set(contacts.flatMap(c => c.tags || [])));

  if (view === 'add' || view === 'edit') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <button data-action="close-contact-form" onClick={closeForm} className="text-gray-500 hover:text-gray-900 p-1 transition-colors">
            <X size={20} />
          </button>
          <div className="flex-1 font-semibold text-gray-900">{view === 'edit' ? 'Edit Contact' : 'New Contact'}</div>
          {listening && (
            <span className="text-xs text-red-500 animate-pulse flex items-center gap-1">
              <Mic size={11} /> Listening…
            </span>
          )}
          <button data-action="save-contact-form" onClick={save} disabled={saving || !form.name.trim() || !form.phone.trim()} className="text-blue-600 font-semibold text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {saveError && (
            <div role="alert" aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}
          {FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input
                  type={f.type}
                  value={(form as any)[f.key]}
                  onChange={e => { setSaveError(''); setForm(p => ({ ...p, [f.key]: e.target.value })); }}
                  placeholder={f.placeholder}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                {f.voice && (
                  <button data-action="voice-input-field"
                    type="button"
                    onClick={() => listening && voiceField === f.key ? stopVoice() : startVoice(f.key)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                      listening && voiceField === f.key
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-50 border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-600'
                    }`}
                  >
                    {listening && voiceField === f.key ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block flex items-center gap-1">
              <Briefcase size={11} /> Deal
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={form.deal_tag}
                onChange={e => setForm(p => ({ ...p, deal_tag: e.target.value }))}
                placeholder="e.g. 123 Main St closing 10/30"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              <button data-action="voice-input-field"
                type="button"
                onClick={() => listening && voiceField === 'deal_tag' ? stopVoice() : startVoice('deal_tag')}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                  listening && voiceField === 'deal_tag'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-50 border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-600'
                }`}
              >
                {listening && voiceField === 'deal_tag' ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">Business</label>
            <select
              value={form.business}
              onChange={e => setForm(p => ({ ...p, business: e.target.value }))}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
            >
              {BUSINESSES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-2 block flex items-center gap-1"><Tag size={11} /> Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_TAGS.map(tag => (
                <button data-action="toggle-tag"
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.tags.includes(tag)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomTag()}
                placeholder="Custom tag…"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              <button data-action="add-custom-tag"
                type="button"
                onClick={addCustomTag}
                disabled={!customTag.trim()}
                className="px-3 py-2 bg-blue-600 text-white text-xs rounded-xl disabled:opacity-30 font-medium"
              >
                Add
              </button>
            </div>
            {form.tags.filter(t => !PRESET_TAGS.includes(t)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.tags.filter(t => !PRESET_TAGS.includes(t)).map(t => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                    {t}
                    <button data-action="remove-tag" onClick={() => setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }))} className="hover:text-red-500"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">Notes</label>
            <div className="flex gap-2 items-start">
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any notes about this contact…"
                rows={3}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
              />
              <button data-action="voice-input-notes"
                type="button"
                onClick={() => listening && voiceField === 'notes' ? stopVoice() : startVoice('notes')}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                  listening && voiceField === 'notes'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-50 border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-600'
                }`}
              >
                {listening && voiceField === 'notes' ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            </div>
          </div>

          {view === 'edit' && editing && (
            <>
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Activity</div>
              {activityLoading ? (
                <div className="text-xs text-gray-400">Loading…</div>
              ) : activity.length === 0 ? (
                <div className="text-xs text-gray-400">No activity yet</div>
              ) : (
                <div className="space-y-3">
                  {activity.map(a => (
                    <div key={`${a.type}-${a.id}`} className="flex gap-3">
                      <div className="text-lg leading-none">{a.type === 'call' ? '📞' : a.type === 'voicemail' ? '📩' : '✅'}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
                        <div className="text-sm text-gray-800 line-clamp-2">{a.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button data-action="download-contact-card"
              onClick={() => downloadVCard(editing!)}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                <Download size={18} className="text-purple-600" />
              </div>
              <span className="font-medium text-gray-900">Download Contact Card</span>
            </button>

                        <button data-action="delete-contact"
              onClick={() => setConfirmDelete(editing)}
              className="flex items-center gap-2 text-red-500 text-sm font-medium pt-2"
            >
              <Trash2 size={15} /> Delete Contact
            </button>
            </>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setConfirmDelete(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle size={26} className="text-red-500" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900 text-lg">Delete Contact?</div>
                  <div className="text-gray-500 text-sm mt-1">
                    <span className="font-medium text-gray-800">{confirmDelete.name}</span> will be permanently removed. This cannot be undone.
                  </div>
                </div>
                <div className="flex flex-col gap-2 w-full mt-2">
                  <button
                    data-action="confirm-delete-contact"
                    onClick={() => del(confirmDelete)}
                    disabled={deleting}
                    className="w-full py-3.5 bg-red-500 active:bg-red-600 text-white font-semibold rounded-2xl transition-colors disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button
                    data-action="cancel-delete-contact"
                    onClick={() => setConfirmDelete(null)}
                    className="w-full py-3.5 bg-gray-100 active:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleScreenshotImport}
      />

      {reminderFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setReminderFor(null)}>
          <div className="w-full max-w-sm bg-white rounded-t-2xl pb-8 pt-4 px-4 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold text-gray-900">📅 Set Reminder for {reminderFor.name}</div>
            <input
              type="datetime-local"
              value={remTime}
              onChange={e => setRemTime(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={remMins}
              onChange={e => setRemMins(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
              <option value={120}>2 hours before</option>
              <option value={1440}>1 day before</option>
            </select>
            <textarea
              value={remMsg}
              onChange={e => setRemMsg(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {remStatus && <div className={`text-sm text-center ${remStatus.includes('!') ? 'text-green-600' : 'text-red-500'}`}>{remStatus}</div>}
            <div className="flex gap-2">
              <button data-action="cancel-reminder" onClick={() => setReminderFor(null)} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold">Cancel</button>
              <button data-action="schedule-reminder" onClick={scheduleReminder} disabled={remBusy || !remTime || !remMsg.trim()} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50">{remBusy ? 'Scheduling…' : 'Schedule'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Action Sheet */}
      {actionSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setActionSheet(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative bg-white rounded-t-3xl px-4 pt-4 pb-8 space-y-2"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <div className="flex items-center gap-3 mb-4 px-1">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-base flex-shrink-0"
                style={{ background: BUSINESSES.find(b => b.id === actionSheet.business)?.color || '#6b7280' }}
              >
                {actionSheet.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-semibold text-gray-900">{actionSheet.name}</div>
                <div className="text-gray-500 text-sm">{actionSheet.phone}</div>
              </div>
            </div>

            <button data-action="call-back"
              onClick={() => { onCall(actionSheet.phone); setActionSheet(null); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <Phone size={18} className="text-green-600" />
              </div>
              <span className="font-medium text-gray-900">Call</span>
            </button>

            <button data-action="send-sms"
              onClick={() => { onSMS(actionSheet.phone); setActionSheet(null); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <MessageSquare size={18} className="text-blue-600" />
              </div>
              <span className="font-medium text-gray-900">Message</span>
            </button>

            <button data-action="copy-contact"
              onClick={() => { copyContact(actionSheet); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                {copied === actionSheet.id ? <Check size={18} className="text-green-600" /> : <Copy size={18} className="text-gray-600" />}
              </div>
              <span className="font-medium text-gray-900">{copied === actionSheet.id ? 'Copied!' : 'Copy number'}</span>
            </button>

            <button data-action="edit-contact"
              onClick={() => openEdit(actionSheet)}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <ChevronRight size={18} className="text-gray-600" />
              </div>
              <span className="font-medium text-gray-900">View / Edit</span>
            </button>

            <button data-action="set-reminder"
              onClick={() => openReminder(actionSheet)}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <span className="text-lg">📅</span>
              </div>
              <span className="font-medium text-gray-900">📅 Set Reminder</span>
            </button>

            <button data-action="delete-contact"
              onClick={() => { setConfirmDelete(actionSheet); setActionSheet(null); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-gray-50 active:bg-gray-100 rounded-2xl text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <span className="font-medium text-red-500">Delete</span>
            </button>

            <button data-action="close-action-sheet"
              onClick={() => setActionSheet(null)}
              className="w-full py-4 text-center text-gray-500 font-medium text-sm mt-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setConfirmDelete(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={26} className="text-red-500" />
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-lg">Delete Contact?</div>
                <div className="text-gray-500 text-sm mt-1">
                  <span className="font-medium text-gray-800">{confirmDelete.name}</span> will be permanently removed. This cannot be undone.
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full mt-2">
                <button
                  data-action="confirm-delete-contact"
                  onClick={() => del(confirmDelete)}
                  disabled={deleting}
                  className="w-full py-3.5 bg-red-500 active:bg-red-600 text-white font-semibold rounded-2xl transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button
                  data-action="cancel-delete-contact"
                  onClick={() => setConfirmDelete(null)}
                  className="w-full py-3.5 bg-gray-100 active:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pt-4 pb-2 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button data-action="import-screenshot"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Import from screenshot"
            className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          </button>
          <button data-action="add-contact"
            onClick={openAdd}
            className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0"
          >
            <Plus size={18} className="text-white" />
          </button>
        </div>

        {importing && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-xl px-3 py-2">
            <Loader2 size={12} className="animate-spin" />
            Reading screenshot with AI…
          </div>
        )}

        {allUsedTags.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button data-action="filter-tag"
              onClick={() => setFilterTag(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium border flex-shrink-0 transition-colors ${
                !filterTag ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              All
            </button>
            {allUsedTags.map(tag => (
              <button data-action="filter-tag"
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className={`px-3 py-1 rounded-full text-xs font-medium border flex-shrink-0 transition-colors ${
                  filterTag === tag ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <User size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">{search || filterTag ? 'No contacts match' : 'No contacts yet'}</p>
            {!search && !filterTag && (
              <div className="flex flex-col gap-2 items-center mt-3">
                <button data-action="import-screenshot" onClick={() => fileInputRef.current?.click()} className="text-blue-600 text-sm font-medium flex items-center gap-1">
                  <Camera size={14} /> Import from screenshot
                </button>
                <button data-action="add-contact" onClick={openAdd} className="text-gray-500 text-sm">Or add manually</button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const biz = BUSINESSES.find(b => b.id === c.business);
              return (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-2xl">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm"
                    style={{ background: biz?.color || '#6b7280' }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => openEdit(c)} style={{ cursor: 'pointer' }}>
                    <div className="font-medium text-gray-900 text-sm truncate">{c.name}</div>
                    <div className="text-gray-500 text-xs truncate">{c.phone}{c.email ? ` · ${c.email}` : ''}</div>
                    {c.deal_tag && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Briefcase size={10} className="text-amber-500 flex-shrink-0" />
                        <span className="text-[10px] text-amber-700 font-medium truncate">{c.deal_tag}</span>
                      </div>
                    )}
                    {(c.tags || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(c.tags || []).slice(0, 3).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">{tag}</span>
                        ))}
                        {(c.tags || []).length > 3 && (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">+{(c.tags || []).length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    data-action="open-contact-actions"
                    onClick={() => setActionSheet(c)}
                    className="w-9 h-9 rounded-xl bg-gray-100 active:bg-gray-200 flex items-center justify-center flex-shrink-0 transition-colors"
                  >
                    <MoreHorizontal size={18} className="text-gray-500" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
