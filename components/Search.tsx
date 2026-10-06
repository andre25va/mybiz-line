'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search as SearchIcon, X, Loader2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSelectContact: (phone: string) => void;
  onSelectMessage: (number: string) => void;
  onSelectTask: () => void;
}

export default function Search({ onClose, onSelectContact, onSelectMessage, onSelectTask }: Props) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [voicemails, setVoicemails] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [openVm, setOpenVm] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setContacts([]); setMessages([]); setVoicemails([]); setTasks([]); setSearched(false); setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const [main, sms] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(term)}`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/sms/search?q=${encodeURIComponent(term)}`).then(r => r.json()).catch(() => []),
        ]);
        if (cancelled) return;
        setContacts(main.contacts || []);
        setVoicemails(main.voicemails || []);
        setTasks(main.tasks || []);
        setMessages(Array.isArray(sms) ? sms : []);
        setSearched(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const none = searched && !loading && !contacts.length && !messages.length && !voicemails.length && !tasks.length;
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="mb-4">
      <div className="px-4 py-1 text-xs font-semibold uppercase text-gray-400">{title}</div>
      <div className="divide-y divide-gray-100 bg-white">{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200">
        <SearchIcon size={18} className="text-gray-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search…"
          className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
        />
        {loading && <Loader2 size={16} className="animate-spin text-gray-400" />}
        <button data-action="close-search" onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {!searched && !loading && (
          <div className="text-center text-gray-400 text-sm px-8 py-16">Search across contacts, messages, voicemails, and tasks</div>
        )}
        {none && <div className="text-center text-gray-400 text-sm py-16">No results</div>}

        {contacts.length > 0 && (
          <Section title="Contacts">
            {contacts.map(c => (
              <button key={c.id} data-action="search-open-contact" onClick={() => { onSelectContact(c.phone); onClose(); }} className="w-full text-left px-4 py-3">
                <div className="text-sm font-medium text-gray-900">{c.name}</div>
                <div className="text-xs text-gray-500">{c.phone}</div>
              </button>
            ))}
          </Section>
        )}
        {messages.length > 0 && (
          <Section title="Messages">
            {messages.map(m => (
              <button key={m.sid} data-action="search-open-message" onClick={() => { onSelectMessage(m.contact); onClose(); }} className="w-full text-left px-4 py-3">
                <div className="text-xs text-gray-500">{m.direction === 'inbound' ? 'From' : 'To'} {m.contact}</div>
                <div className="text-sm text-gray-900 line-clamp-2">{m.body}</div>
              </button>
            ))}
          </Section>
        )}
        {voicemails.length > 0 && (
          <Section title="Voicemails">
            {voicemails.map(v => (
              <button key={v.id} data-action="search-open-voicemail" onClick={() => setOpenVm(openVm === v.id ? null : v.id)} className="w-full text-left px-4 py-3">
                <div className="text-xs text-gray-500">{v.caller_number} · {new Date(v.created_at).toLocaleDateString()}</div>
                <div className={`text-sm text-gray-900 ${openVm === v.id ? '' : 'line-clamp-2'}`}>{v.transcript}</div>
              </button>
            ))}
          </Section>
        )}
        {tasks.length > 0 && (
          <Section title="Tasks">
            {tasks.map(t => (
              <button key={t.id} data-action="search-open-task" onClick={() => { onSelectTask(); onClose(); }} className="w-full text-left px-4 py-3">
                <div className={`text-sm font-medium ${t.done ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</div>
                {t.notes && <div className="text-xs text-gray-500 line-clamp-1">{t.notes}</div>}
              </button>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
