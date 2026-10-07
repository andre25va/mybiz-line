'use client';

import { useEffect, useState } from 'react';
import SystemHealthSection from '@/components/admin/SystemHealthSection';

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

interface AiSettings {
  provider: string;
  api_key: string;
  model: string;
}

const PROVIDERS = [
  { id: 'openai', label: 'ChatGPT (OpenAI)', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'anthropic', label: 'Claude (Anthropic)', models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5'] },
  { id: 'xai', label: 'Grok (xAI)', models: ['grok-2', 'grok-2-mini'] },
];

const PROMPT_FILES: Record<string, string> = {
  openai: 'prompts/chatgpt-system.md',
  anthropic: 'prompts/claude-system.md',
  xai: 'prompts/grok-system.md',
};

export default function AdminPage() {
  const [tab, setTab] = useState<'users' | 'ai'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // AI Settings state
  const [aiSettings, setAiSettings] = useState<AiSettings>({ provider: 'openai', api_key: '', model: 'gpt-4o-mini' });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  }

  async function loadAiSettings() {
    const res = await fetch('/api/admin/ai-settings');
    if (res.ok) {
      const data = await res.json();
      if (data.settings) setAiSettings(data.settings);
    }
  }

  useEffect(() => { load(); loadAiSettings(); }, []);

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

  async function saveAiSettings(e: React.FormEvent) {
    e.preventDefault();
    setAiSaving(true);
    setAiMsg('');
    const res = await fetch('/api/admin/ai-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiSettings),
    });
    const data = await res.json();
    if (res.ok) {
      setAiMsg('✅ AI settings saved.');
    } else {
      setAiMsg(`❌ ${data.error || 'Failed to save'}`);
    }
    setAiSaving(false);
  }

  async function testAiKey() {
    setAiTesting(true);
    setAiMsg('');
    const res = await fetch('/api/admin/ai-settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiSettings),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setAiMsg('✅ Connection successful — API key is valid.');
    } else {
      setAiMsg(`❌ ${data.error || 'Connection failed — check your key.'}`);
    }
    setAiTesting(false);
  }

  const selectedProvider = PROVIDERS.find(p => p.id === aiSettings.provider)!;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">MyBiz Line Admin</h1>
            <p className="text-sm text-gray-500">Manage accounts and settings</p>
          </div>
          {tab === 'users' && (
            <button
              data-action="admin-add-user"
              onClick={() => setShowAdd(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
            >
              + Add User
            </button>
          )}
        </div>
        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            data-action="admin-tab-users"
            onClick={() => setTab('users')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            Users
          </button>
          <button
            data-action="admin-tab-ai"
            onClick={() => setTab('ai')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'ai' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            🤖 AI Provider
          </button>
        </div>
      </div>

      <SystemHealthSection />

      {/* Users Tab */}
      {tab === 'users' && (
        <>
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
        </>
      )}

      {/* AI Provider Tab */}
      {tab === 'ai' && (
        <div className="px-6 py-4 pb-12">
          <form onSubmit={saveAiSettings} className="space-y-5">
            {/* Provider picker */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">AI Provider</label>
              <div className="space-y-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    data-action="admin-ai-select-provider"
                    onClick={() => setAiSettings({ ...aiSettings, provider: p.id, model: p.models[0] })}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                      aiSettings.provider === p.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="font-medium text-gray-900 text-sm">{p.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">System prompt: <code>{PROMPT_FILES[p.id]}</code></div>
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Model</label>
              <select
                value={aiSettings.model}
                onChange={e => setAiSettings({ ...aiSettings, model: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {selectedProvider.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={aiSettings.api_key}
                  onChange={e => setAiSettings({ ...aiSettings, api_key: e.target.value })}
                  placeholder="Paste your API key here"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <button
                  type="button"
                  data-action="admin-ai-toggle-key-visibility"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Stored securely — never exposed to clients</p>
            </div>

            {/* Prompt preview */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">System Prompt File</span>
                <span className="text-xs text-blue-600 font-mono">{PROMPT_FILES[aiSettings.provider]}</span>
              </div>
              <p className="text-xs text-gray-500">
                This prompt gives your AI full contact context, conversation history, open tasks, and clear rules — including never sending without your approval.
              </p>
            </div>

            {aiMsg && (
              <div className={`text-sm rounded-lg px-4 py-3 ${
                aiMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {aiMsg}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                data-action="admin-ai-test-key"
                onClick={testAiKey}
                disabled={!aiSettings.api_key || aiTesting}
                className="flex-1 border border-blue-500 text-blue-600 py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                {aiTesting ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                type="submit"
                data-action="admin-ai-save-settings"
                disabled={aiSaving || !aiSettings.api_key}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                {aiSaving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

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
    </div>
  );
}
