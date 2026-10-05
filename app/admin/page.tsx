'use client';

import { useEffect, useState } from 'react';

interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  status: string;
  api_key: string;
  created_at: string;
  message_count?: number;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg(`✅ Account created. Welcome SMS sent to ${form.phone}.`);
      setForm({ name: '', phone: '', email: '' });
      setShowAdd(false);
      load();
    } else {
      setMsg(`❌ ${data.error || 'Failed to create user'}`);
    }
    setSaving(false);
  }

  async function suspendUser(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: newStatus }),
    });
    if (res.ok) load();
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">MyBiz Line Admin</h1>
          <p className="text-sm text-gray-500">Manage accounts and users</p>
        </div>
        <button
          data-action="admin-add-user"
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
        >
          + Add User
        </button>
      </div>

      {/* Stats bar */}
      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{users.length}</div>
          <div className="text-xs text-gray-500 mt-1">Total Accounts</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{users.filter(u => u.status === 'active').length}</div>
          <div className="text-xs text-gray-500 mt-1">Active</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-400">{users.filter(u => u.status === 'suspended').length}</div>
          <div className="text-xs text-gray-500 mt-1">Suspended</div>
        </div>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add New User</h2>
            <form onSubmit={addUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+13125551234"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">They'll receive a welcome SMS at this number</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {msg && (
                <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {msg}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  data-action="admin-cancel-add-user"
                  onClick={() => { setShowAdd(false); setMsg(''); }}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-action="admin-confirm-add-user"
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User List */}
      <div className="px-6 pb-8">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading accounts…</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-3">👤</div>
            <p className="font-medium">No accounts yet</p>
            <p className="text-sm mt-1">Tap + Add User to create the first account</p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map(user => (
              <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${user.role === 'admin' ? 'bg-purple-600' : 'bg-blue-600'}`}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 flex items-center gap-2">
                        {user.name}
                        {user.role === 'admin' && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Admin</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {user.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">{user.phone}</div>
                      {user.email && <div className="text-xs text-gray-400">{user.email}</div>}
                    </div>
                  </div>
                  {user.role !== 'admin' && (
                    <button
                      data-action="admin-toggle-user-status"
                      onClick={() => suspendUser(user.id, user.status)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${user.status === 'active' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-600 border border-green-200'}`}
                    >
                      {user.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  )}
                </div>

                {/* API Key */}
                <div className="mt-3 bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-gray-400">API Key</div>
                    <div className="text-xs font-mono text-gray-600 truncate max-w-[200px]">{user.api_key}</div>
                  </div>
                  <button
                    data-action="admin-copy-api-key"
                    onClick={() => copyKey(user.api_key)}
                    className="text-xs text-blue-600 font-medium shrink-0"
                  >
                    {copiedKey === user.api_key ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-400">
                  Created {new Date(user.created_at).toLocaleDateString()}
                  {user.message_count !== undefined && ` · ${user.message_count} messages`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
