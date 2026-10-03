'use client';
import { useState, useEffect } from 'react';
import { Plus, Search, Phone, MessageSquare, X, ChevronRight, User, Trash2 } from 'lucide-react';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  business: string;
  created_at: string;
}

const BUSINESSES = [
  { id: 'myredeal', name: 'MyReDeal', color: '#16a34a' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

interface Props {
  onCall: (n: string) => void;
  onSMS: (n: string) => void;
}

export default function Contacts({ onCall, onSMS }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal' });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/contacts');
    const d = await r.json();
    setContacts(Array.isArray(d) ? d : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setForm({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal' });
    setEditing(null);
    setView('add');
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone, email: c.email || '', address: c.address || '', notes: c.notes || '', business: c.business });
    setView('edit');
  };

  const closeForm = () => {
    setView('list');
    setEditing(null);
    setForm({ name: '', phone: '', email: '', address: '', notes: '', business: 'myredeal' });
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

  if (view === 'add' || view === 'edit') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button onClick={closeForm} className="text-subtext hover:text-text p-1 transition-colors">
            <X size={20} />
          </button>
          <div className="flex-1 font-semibold text-text">{view === 'edit' ? 'Edit Contact' : 'New Contact'}</div>
          <button onClick={save} disabled={saving || !form.name.trim() || !form.phone.trim()} className="text-accent font-semibold text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {[
            { label: 'Name *', key: 'name', type: 'text', placeholder: 'Full name' },
            { label: 'Phone *', key: 'phone', type: 'tel', placeholder: '+1 (555) 000-0000' },
            { label: 'Email', key: 'email', type: 'email', placeholder: 'email@example.com' },
            { label: 'Address', key: 'address', type: 'text', placeholder: '123 Main St, City, ST' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs text-subtext font-medium mb-1.5 block">{f.label}</label>
              <input
                type={f.type}
                value={(form as any)[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-subtext font-medium mb-1.5 block">Business</label>
            <select
              value={form.business}
              onChange={e => setForm(p => ({ ...p, business: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent"
            >
              {BUSINESSES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-subtext font-medium mb-1.5 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Any notes about this contact…"
              rows={3}
              className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent resize-none"
            />
          </div>
          {view === 'edit' && editing && (
            <button
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
      <div className="px-4 pt-4 pb-2 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtext" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={openAdd}
            className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0"
          >
            <Plus size={18} className="text-white" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="text-center py-8 text-subtext text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <User size={40} className="mx-auto text-border mb-3" />
            <p className="text-subtext text-sm">{search ? 'No contacts match' : 'No contacts yet'}</p>
            {!search && (
              <button onClick={openAdd} className="mt-3 text-accent text-sm font-medium">
                Add your first contact
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const biz = BUSINESSES.find(b => b.id === c.business);
              return (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm"
                    style={{ background: biz?.color || '#6b7280' }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(c)}>
                    <div className="font-medium text-text text-sm truncate">{c.name}</div>
                    <div className="text-subtext text-xs truncate">{c.phone}</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => onSMS(c.phone)}
                      className="w-8 h-8 rounded-xl bg-surface flex items-center justify-center text-subtext hover:text-accent hover:bg-green-50 transition-colors"
                    >
                      <MessageSquare size={14} />
                    </button>
                    <button
                      onClick={() => onCall(c.phone)}
                      className="w-8 h-8 rounded-xl bg-surface flex items-center justify-center text-subtext hover:text-accent hover:bg-green-50 transition-colors"
                    >
                      <Phone size={14} />
                    </button>
                  </div>
                  <ChevronRight size={14} className="text-border flex-shrink-0 cursor-pointer" onClick={() => openEdit(c)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
