'use client';
import { useState, useEffect } from 'react';
import { Phone, MessageSquare, Grid3x3, Users, CheckSquare, Settings, X, Link2, Plus, Trash2, ChevronRight, FileText } from 'lucide-react';

interface SavedLink { name: string; url: string; }
interface Template { name: string; body: string; }

function getLinks(): SavedLink[] {
  try { return JSON.parse(localStorage.getItem('mybiz_links') || '[]'); } catch { return []; }
}
function saveLinks(links: SavedLink[]) {
  localStorage.setItem('mybiz_links', JSON.stringify(links));
}
function getTemplates(): Template[] {
  try { return JSON.parse(localStorage.getItem('mybiz_templates') || '[]'); } catch { return []; }
}
function saveTemplates(t: Template[]) {
  localStorage.setItem('mybiz_templates', JSON.stringify(t));
}
import { useTwilioDevice } from '@/hooks/useTwilioDevice';
import Dialpad from './Dialpad';
import ActiveCall from './ActiveCall';
import CallLog from './CallLog';
import SMSInbox from './SMSInbox';
import SMSThread from './SMSThread';
import IncomingCall from './IncomingCall';
import Contacts from './Contacts';
import Tasks from './Tasks';

type Tab = 'calls' | 'messages' | 'dialpad' | 'contacts' | 'tasks';

const BUSINESSES = [
  { id: 'myredeal', name: 'MyReDeal', color: '#16a34a' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

export default function AppShell() {
  const [tab, setTab] = useState<Tab>('dialpad');
  const [smsContact, setSmsContact] = useState<string | null>(null);
  const [activeNumber, setActiveNumber] = useState('');
  const [biz, setBiz] = useState(BUSINESSES[0]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState<'main' | 'links' | 'templates'>('main');
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [linkForm, setLinkForm] = useState({ name: '', url: '' });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplForm, setTplForm] = useState({ name: '', body: '' });
  // Prefill state for "Save to Contacts" from SMS thread
  const [contactPrefill, setContactPrefill] = useState<{ phone?: string; email?: string } | null>(null);

  useEffect(() => { setLinks(getLinks()); setTemplates(getTemplates()); }, []);

  const addLink = () => {
    if (!linkForm.name.trim() || !linkForm.url.trim()) return;
    const updated = [...links, { name: linkForm.name.trim(), url: linkForm.url.trim() }];
    setLinks(updated); saveLinks(updated); setLinkForm({ name: '', url: '' });
  };
  const deleteLink = (i: number) => {
    const updated = links.filter((_, idx) => idx !== i);
    setLinks(updated); saveLinks(updated);
  };

  const addTemplate = () => {
    if (!tplForm.name.trim() || !tplForm.body.trim()) return;
    const updated = [...templates, { name: tplForm.name.trim(), body: tplForm.body.trim() }];
    setTemplates(updated); saveTemplates(updated); setTplForm({ name: '', body: '' });
  };
  const deleteTemplate = (i: number) => {
    const updated = templates.filter((_, idx) => idx !== i);
    setTemplates(updated); saveTemplates(updated);
  };

  const { status, isReady, muted, incoming, duration, makeCall, hangup, toggleMute, acceptCall, rejectCall } =
    useTwilioDevice();

  const isOnCall = status !== 'idle';

  function handleCall(to: string) {
    setActiveNumber(to);
    setTab('dialpad');
    makeCall(to);
  }

  function handleSMS(number: string) {
    setSmsContact(number);
    setTab('messages');
  }

  function handleAddContact(phone: string, prefill?: { email?: string }) {
    setContactPrefill({ phone, email: prefill?.email });
    setTab('contacts');
  }

  return (
    <div className="flex flex-col h-screen bg-surface max-w-md mx-auto relative">
      {/* Incoming call overlay */}
      {incoming && (
        <IncomingCall from={incoming.from} onAccept={acceptCall} onReject={rejectCall} />
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="absolute inset-0 bg-surface z-50 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
            <button
              onClick={() => settingsPage !== 'main' ? setSettingsPage('main') : setShowSettings(false)}
              className="text-subtext hover:text-text p-1 transition-colors"
            >
              <X size={20} />
            </button>
            <span className="font-semibold text-text">
              {settingsPage === 'links' ? 'Saved Links' : settingsPage === 'templates' ? 'Message Templates' : 'Settings'}
            </span>
          </div>

          {/* MAIN settings page */}
          {settingsPage === 'main' && (
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
              <div>
                <h2 className="text-text font-semibold text-lg mb-1">MyBiz Line</h2>
                <p className="text-subtext text-sm">Beta v0.1 · Your number: +1 (464) 733-3257</p>
              </div>

              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="text-text font-medium mb-3">Business Profiles</h3>
                <div className="space-y-2">
                  {BUSINESSES.map(b => (
                    <div
                      key={b.id}
                      onClick={() => { setBiz(b); setShowSettings(false); }}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                        biz.id === b.id ? 'bg-green-50 border border-accent' : 'hover:bg-surface'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: b.color }} />
                      <span className={`text-sm font-medium ${biz.id === b.id ? 'text-accent' : 'text-text'}`}>
                        {b.name}
                      </span>
                      {biz.id === b.id && <span className="ml-auto text-accent text-xs font-medium">Active</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Links */}
              <button
                onClick={() => setSettingsPage('links')}
                className="w-full bg-card border border-border rounded-2xl p-4 flex items-center gap-3 hover:bg-surface transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Link2 size={16} className="text-accent" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-text font-medium text-sm">Saved Links</div>
                  <div className="text-subtext text-xs">{links.length} link{links.length !== 1 ? 's' : ''} · tap to insert in messages</div>
                </div>
                <ChevronRight size={16} className="text-border" />
              </button>

              {/* Templates */}
              <button
                onClick={() => setSettingsPage('templates')}
                className="w-full bg-card border border-border rounded-2xl p-4 flex items-center gap-3 hover:bg-surface transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-text font-medium text-sm">Message Templates</div>
                  <div className="text-subtext text-xs">{templates.length} template{templates.length !== 1 ? 's' : ''} · quick-insert into SMS</div>
                </div>
                <ChevronRight size={16} className="text-border" />
              </button>

              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="text-text font-medium mb-1">AI Assistant</h3>
                <p className="text-subtext text-sm">
                  Tap the ✨ sparkle icon in any SMS thread to detect appointments and add them to your
                  calendar or task list.
                </p>
              </div>

              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="text-text font-medium mb-3">Account</h3>
                <a href="/api/auth/logout" className="text-red-500 text-sm font-medium">
                  Sign out
                </a>
              </div>
            </div>
          )}

          {/* TEMPLATES page */}
          {settingsPage === 'templates' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-4 pb-3 bg-card border-b border-border space-y-2">
                <input
                  value={tplForm.name}
                  onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Template name (e.g. Follow Up)"
                  className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
                />
                <div className="flex gap-2 items-start">
                  <textarea
                    value={tplForm.body}
                    onChange={e => setTplForm(p => ({ ...p, body: e.target.value }))}
                    placeholder="Message text…"
                    rows={3}
                    className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent resize-none"
                  />
                  <button
                    onClick={addTemplate}
                    disabled={!tplForm.name.trim() || !tplForm.body.trim()}
                    className="w-10 h-10 rounded-xl bg-accent disabled:opacity-30 flex items-center justify-center flex-shrink-0 mt-0.5"
                  >
                    <Plus size={18} className="text-white" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {templates.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText size={36} className="mx-auto text-border mb-3" />
                    <p className="text-subtext text-sm">No templates yet</p>
                    <p className="text-subtext text-xs mt-1">Add follow-ups, intros, appointment confirmations…</p>
                  </div>
                ) : (
                  templates.map((t, i) => (
                    <div key={i} className="p-3 bg-card border border-border rounded-2xl">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-text">{t.name}</span>
                        <button onClick={() => deleteTemplate(i)} className="text-red-400 hover:text-red-600 p-1 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-subtext line-clamp-2">{t.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* LINKS page */}
          {settingsPage === 'links' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Add link form */}
              <div className="px-4 pt-4 pb-3 bg-card border-b border-border space-y-2">
                <input
                  value={linkForm.name}
                  onChange={e => setLinkForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Link name (e.g. Google Reviews)"
                  className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <input
                    value={linkForm.url}
                    onChange={e => setLinkForm(p => ({ ...p, url: e.target.value }))}
                    placeholder="https://..."
                    type="url"
                    className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={addLink}
                    disabled={!linkForm.name.trim() || !linkForm.url.trim()}
                    className="w-10 h-10 rounded-xl bg-accent disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                  >
                    <Plus size={18} className="text-white" />
                  </button>
                </div>
              </div>

              {/* Links list */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {links.length === 0 ? (
                  <div className="text-center py-12">
                    <Link2 size={36} className="mx-auto text-border mb-3" />
                    <p className="text-subtext text-sm">No saved links yet</p>
                    <p className="text-subtext text-xs mt-1">Add your Google Review, booking page, website…</p>
                  </div>
                ) : (
                  links.map((link, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl">
                      <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                        <Link2 size={14} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text truncate">{link.name}</div>
                        <div className="text-xs text-subtext truncate">{link.url}</div>
                      </div>
                      <button onClick={() => deleteLink(i)} className="text-red-400 hover:text-red-600 p-1 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border flex-shrink-0">
        <div className="text-lg font-bold text-text">MyBiz Line</div>
        <div className="flex items-center gap-2">
          {!isReady && <span className="text-xs text-subtext">Connecting…</span>}
          {isReady && !isOnCall && <span className="w-2 h-2 rounded-full bg-accent" title="Ready" />}
          <select
            value={biz.id}
            onChange={e => setBiz(BUSINESSES.find(b => b.id === e.target.value) || BUSINESSES[0])}
            className="text-sm font-medium bg-surface border border-border rounded-lg px-2 py-1 text-text focus:outline-none focus:border-accent"
          >
            {BUSINESSES.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-subtext hover:text-text transition-colors rounded-lg hover:bg-surface"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Active call banner */}
        {isOnCall && (
          <div className="pt-4">
            <ActiveCall
              status={status}
              duration={duration}
              number={activeNumber}
              muted={muted}
              onHangup={hangup}
              onToggleMute={toggleMute}
              activeConn={null}
            />
          </div>
        )}

        {!isOnCall && (
          <>
            {tab === 'dialpad' && (
              <div className="px-4 pt-4">
                <Dialpad onCall={handleCall} disabled={isOnCall} />
              </div>
            )}
            {tab === 'calls' && <CallLog myNumber="+14647333257" onCall={handleCall} />}
            {tab === 'messages' && (
              smsContact ? (
                <div className="flex flex-col" style={{ height: 'calc(100vh - 132px)' }}>
                  <SMSThread
                    number={smsContact}
                    onBack={() => setSmsContact(null)}
                    onCall={handleCall}
                    onAddContact={handleAddContact}
                  />
                </div>
              ) : (
                <SMSInbox onSelect={n => setSmsContact(n)} />
              )
            )}
            {tab === 'contacts' && (
              <Contacts
                onCall={handleCall}
                onSMS={handleSMS}
                prefillPhone={contactPrefill?.phone}
                prefillEmail={contactPrefill?.email}
                onPrefillUsed={() => setContactPrefill(null)}
              />
            )}
            {tab === 'tasks' && <Tasks />}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="flex bg-card border-t border-border flex-shrink-0 safe-area-pb">
        {([
          { id: 'calls', icon: Phone, label: 'Recents' },
          { id: 'messages', icon: MessageSquare, label: 'Messages' },
          { id: 'dialpad', icon: Grid3x3, label: 'Keypad' },
          { id: 'contacts', icon: Users, label: 'Contacts' },
          { id: 'tasks', icon: CheckSquare, label: 'Tasks' },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id !== 'messages') setSmsContact(null);
            }}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
              tab === id ? 'text-accent' : 'text-subtext hover:text-text'
            }`}
          >
            <Icon size={20} />
            <span className="text-xs">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
