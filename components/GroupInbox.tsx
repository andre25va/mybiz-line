'use client';
import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, X, Check } from 'lucide-react';

const BIZ_COLORS: Record<string, string> = {
  'myredeal': '#16a34a',
  'contractors-kc': '#ea580c',
  'personal': '#374151',
};

const BIZ_LABELS: Record<string, string> = {
  'myredeal': 'MyReDeal',
  'contractors-kc': 'Contractors of KC',
  'personal': 'Personal',
};

interface GroupThread {
  id: string;
  name: string;
  business: string;
  members: { phone: string; name?: string; business?: string }[];
  lastMsg?: string;
  lastTime?: string;
  unread?: number;
}

interface Props {
  contacts: any[];
  onSelect: (group: GroupThread) => void;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function fmtTime(t?: string) {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

function dominantBiz(members: { business?: string }[]): string {
  const counts: Record<string, number> = {};
  for (const m of members) {
    const b = m.business || 'personal';
    counts[b] = (counts[b] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'personal';
}

export default function GroupInbox({ contacts, onSelect }: Props) {
  const [groups, setGroups] = useState<GroupThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // New group form state
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    fetch('/api/groups')
      .then(r => r.json())
      .then(d => { setGroups(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredContacts = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  );

  const toggleContact = (phone: string) => {
    setSelected(prev => prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]);
  };

  // Auto-name from selected contacts
  useEffect(() => {
    if (selected.length > 0 && !groupName) {
      const names = selected.map(p => {
        const c = contacts.find(c => c.phone === p);
        return c?.name?.split(' ')[0] || p;
      });
      setGroupName(names.join(', '));
    }
  }, [selected]);

  const createGroup = async () => {
    if (!groupName.trim() || selected.length < 1) return;
    setSaving(true);
    const members = selected.map(phone => {
      const c = contacts.find(c => c.phone === phone);
      return { phone, name: c?.name, business: c?.business };
    });
    const business = dominantBiz(members);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName, business, members }),
      });
      const group = await res.json();
      setCreating(false);
      setGroupName('');
      setSelected([]);
      setSearch('');
      load();
      if (group.id) onSelect(group);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="font-semibold text-gray-900 text-sm">Group Threads</span>
        <button
          data-action="new-group"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-blue-600 text-sm font-medium"
        >
          <Plus size={16} /> New Group
        </button>
      </div>

      {/* Create group panel */}
      {creating && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">New Group</span>
            <button data-action="close-new-group" onClick={() => { setCreating(false); setSelected([]); setGroupName(''); setSearch(''); }}>
              <X size={18} className="text-gray-400" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Group name…"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {filteredContacts.map(c => {
              const bizColor = BIZ_COLORS[c.business] || '#374151';
              const isSelected = selected.includes(c.phone);
              return (
                <div
                  key={c.phone}
                  onClick={() => toggleContact(c.phone)}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: bizColor }}>
                    {c.name?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                    <div className="text-xs text-gray-400">{c.phone}</div>
                  </div>
                  {isSelected && <Check size={16} className="text-blue-600 flex-shrink-0" />}
                </div>
              );
            })}
            {filteredContacts.length === 0 && (
              <div className="text-center py-4 text-gray-400 text-sm">No contacts found</div>
            )}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map(p => {
                const c = contacts.find(c => c.phone === p);
                return (
                  <span key={p} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs rounded-full px-2 py-1">
                    {c?.name || p}
                    <button onClick={() => toggleContact(p)}><X size={11} /></button>
                  </span>
                );
              })}
            </div>
          )}
          <button
            data-action="create-group"
            disabled={selected.length < 1 || !groupName.trim() || saving}
            onClick={createGroup}
            className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-30 transition-opacity"
          >
            {saving ? 'Creating…' : `Create Group (${selected.length} member${selected.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      )}

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {loading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}
        {!loading && groups.length === 0 && (
          <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
            <Users size={32} />
            <span className="text-sm">No groups yet</span>
            <span className="text-xs text-gray-300">Tap New Group to get started</span>
          </div>
        )}
        {groups.map(g => {
          const bizColor = BIZ_COLORS[g.business] || '#374151';
          return (
            <div
              key={g.id}
              onClick={() => onSelect(g)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer bg-white"
            >
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: bizColor }}>
                  <Users size={18} className="text-white" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ background: bizColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className="font-semibold text-sm text-gray-900 truncate">{g.name}</span>
                  <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{fmtTime(g.lastTime)}</span>
                </div>
                <div className="text-xs text-gray-400 truncate mt-0.5">
                  {g.members.map(m => m.name || m.phone).join(', ')}
                </div>
                {g.lastMsg && <div className="text-gray-500 text-xs truncate mt-0.5">{g.lastMsg}</div>}
              </div>
              {g.unread ? (
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{g.unread}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
