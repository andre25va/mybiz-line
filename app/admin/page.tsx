'use client';

import React, { useEffect, useState } from 'react';
import SystemHealthSection from '@/components/admin/SystemHealthSection';
import { parseAdminUsers, UsersReadOnlyList, type AdminUserRecord } from '@/components/admin/UsersReadOnlyList';

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
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listUnavailable, setListUnavailable] = useState(false);

  // AI Settings state
  const [aiSettings, setAiSettings] = useState<AiSettings>({ provider: 'openai', api_key: '', model: 'gpt-4o-mini' });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!res.ok) {
        setUsers([]);
        setListUnavailable(true);
        return;
      }
      const parsed = parseAdminUsers(await res.json());
      if (!parsed) {
        setUsers([]);
        setListUnavailable(true);
        return;
      }
      setUsers(parsed);
      setListUnavailable(false);
    } catch {
      setUsers([]);
      setListUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadAiSettings() {
    const res = await fetch('/api/admin/ai-settings');
    if (res.ok) {
      const data = await res.json();
      if (data.settings) setAiSettings(data.settings);
    }
  }

  useEffect(() => { load(); loadAiSettings(); }, []);

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
        <div className="px-6 py-4 pb-8">
          <p className="mb-4 text-sm text-gray-600">This account list is read-only. Account changes are not available here.</p>
          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading accounts…</div>
          ) : listUnavailable ? (
            <p className="text-sm text-gray-700">User list is unavailable.</p>
          ) : (
            <UsersReadOnlyList users={users} />
          )}
        </div>
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

    </div>
  );
}
