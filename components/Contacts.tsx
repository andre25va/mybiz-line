'use client';
import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Phone, MessageSquare, X, User, Trash2, Mic, MicOff, Copy, Check, Tag, Camera, Loader2, Briefcase, MoreHorizontal, ChevronRight } from 'lucide-react';

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
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal', tags: [] as string[], deal_tag: '' });
  const [customTag, setCustomTag] = useState('');
  const [importing, setImporting] = useState(false);
  const [actionSheet, setActionSheet] = useState<Contact | null>(null);
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
    if (editing) {
      await fetch(`/api/contacts?id=${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    setSaving(false);
    closeForm();
    load();
  };

  const del = async (id: string) => {
    await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' });
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
          {FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input
                  type={f.type}
                  value={(form as any)[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
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

          {/* Deal Tag */}
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
            <button data-action="delete-contact"
              onClick={() => del(editing.id)}
              className="flex items-center gap-2 text-red-500 text-sm font-medium pt-2"
            >
              <Trash2 size={15} /> Delete Contact
            </button>
          )}
        </div>
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

      {/* Action Sheet */}
      {actionSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setActionSheet(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative bg-white rounded-t-3xl px-4 pt-4 pb-8 space-y-2"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            {/* Contact header */}
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

            {/* Action buttons */}
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
              onClick={() => { copyContact(actionSheet); setActionSheet(null); }}
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

            <button data-action="close-action-sheet"
              onClick={() => setActionSheet(null)}
              className="w-full py-4 text-center text-gray-500 font-medium text-sm mt-1"
            >
              Cancel
            </button>
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
