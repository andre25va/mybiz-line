'use client';
import { useState, useEffect } from 'react';
import { Phone, MessageSquare, Grid3x3, Users, CheckSquare, Settings, X, Link2, Plus, Trash2, ChevronRight, FileText, Home, PenSquare, PhoneMissed, Voicemail as VoicemailIcon } from 'lucide-react';

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
import { usePushNotifications } from '@/hooks/usePushNotifications';
import Dialpad from './Dialpad';
import ActiveCall from './ActiveCall';
import CallLog from './CallLog';
import SMSInbox from './SMSInbox';
import SMSThread from './SMSThread';
import IncomingCall from './IncomingCall';
import Contacts from './Contacts';
import Tasks from './Tasks';
import Voicemail from './Voicemail';
import GroupInbox from './GroupInbox';
import GroupThread from './GroupThread';

type Tab = 'home' | 'messages' | 'groups' | 'dialpad' | 'contacts' | 'tasks' | 'voicemail';
type DialpadView = 'keypad' | 'recents';

export const BUSINESSES = [
  { id: 'myredeal', name: 'Real Estate', color: '#16a34a' },
  { id: 'personal', name: 'Personal', color: '#374151' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

const MY_NUMBER = '+14647333257';
const MY_NUMBER_DISPLAY = '(464) 733-3257';

interface BizStats { unread: number; missed: number; }
interface DashStats {
  myredeal: BizStats;
  'contractors-kc': BizStats;
  personal: BizStats;
  tasks: number;
}

export default function AppShell() {
  const [tab, setTab] = useState<Tab>('home');
  const [dialpadView, setDialpadView] = useState<DialpadView>('keypad');
  const [smsContact, setSmsContact] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<any | null>(null);
  const [activeNumber, setActiveNumber] = useState('');
  const [biz, setBiz] = useState(BUSINESSES[0]);
  const [showSettings, setShowSettings] = useState(false);
  const [textSize, setTextSize] = useState<'small' | 'medium' | 'large'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('mybiz_textsize') as any) || 'medium';
    return 'medium';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('text-size-small', 'text-size-medium', 'text-size-large');
    root.classList.add(`text-size-${textSize}`);
    localStorage.setItem('mybiz_textsize', textSize);
  }, [textSize]);
  const [settingsPage, setSettingsPage] = useState<'main' | 'links' | 'templates'>('main');
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [linkForm, setLinkForm] = useState({ name: '', url: '' });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplForm, setTplForm] = useState({ name: '', body: '' });
  const [contactPrefill, setContactPrefill] = useState<{ phone?: string; email?: string } | null>(null);
  const [dashStats, setDashStats] = useState<DashStats>({
    myredeal: { unread: 0, missed: 0 },
    'contractors-kc': { unread: 0, missed: 0 },
    personal: { unread: 0, missed: 0 },
    tasks: 0,
  });
  const [recentConvos, setRecentConvos] = useState<any[]>([]);
  const [allContacts, setAllContacts] = useState<any[]>([]);

  useEffect(() => { setLinks(getLinks()); setTemplates(getTemplates()); }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [inboxRes, callsRes, tasksRes, contactsRes] = await Promise.all([
          fetch('/api/sms/inbox').then(r => r.json()).catch(() => []),
          fetch('/api/calls/history').then(r => r.json()).catch(() => []),
          fetch('/api/tasks').then(r => r.json()).catch(() => []),
          fetch('/api/contacts').then(r => r.json()).catch(() => []),
        ]);
        const inbox = Array.isArray(inboxRes) ? inboxRes : [];
        const calls = Array.isArray(callsRes) ? callsRes : [];
        const tasks = Array.isArray(tasksRes) ? tasksRes : [];
        const contacts = Array.isArray(contactsRes) ? contactsRes : [];
        setAllContacts(contacts);

        const phoneMap: Record<string, string> = {};
        for (const c of contacts) {
          const normalized = c.phone.replace(/\D/g, '');
          phoneMap[normalized] = c.business;
        }

        const stats: DashStats = {
          myredeal: { unread: 0, missed: 0 },
          'contractors-kc': { unread: 0, missed: 0 },
          personal: { unread: 0, missed: 0 },
          tasks: tasks.filter((t: any) => !t.done).length,
        };

        for (const convo of inbox) {
          const normalized = convo.number.replace(/\D/g, '');
          const bizId = phoneMap[normalized] || 'personal';
          const key = (bizId === 'myredeal' || bizId === 'contractors-kc') ? bizId : 'personal';
          if (convo.unread > 0) (stats[key as keyof DashStats] as BizStats).unread++;
        }

        for (const call of calls) {
          if (call.status === 'no-answer' || call.status === 'busy') {
            const normalized = (call.from || call.to || '').replace(/\D/g, '');
            const bizId = phoneMap[normalized] || 'personal';
            const key = (bizId === 'myredeal' || bizId === 'contractors-kc') ? bizId : 'personal';
            (stats[key as keyof DashStats] as BizStats).missed++;
          }
        }

        setDashStats(stats);
        setRecentConvos(inbox.slice(0, 4).map((c: any) => {
          const normalized = c.number.replace(/\D/g, '');
          return { ...c, bizId: phoneMap[normalized] || 'personal' };
        }));
      } catch {}
    };
    fetchData();
  }, [tab]);

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

  const { status, isReady, muted, incoming, duration, connRef, makeCall, hangup, toggleMute, acceptCall, rejectCall } =
    useTwilioDevice();
  usePushNotifications();

  const isOnCall = status !== 'idle';

  function handleCall(to: string) {
    setActiveNumber(to);
    setTab('dialpad');
    setDialpadView('keypad');
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

  const initial = biz.name.charAt(0).toUpperCase();

  const BIZ_ROWS = [
    { id: 'myredeal', name: 'Real Estate', color: '#16a34a', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
    { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
    { id: 'personal', name: 'Personal', color: '#374151', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' },
  ];

  return (
    <div className="flex flex-col h-screen bg-white max-w-md mx-auto relative">
      {incoming && (
        <IncomingCall from={incoming.from} onAccept={() => { setActiveNumber(incoming.from); acceptCall(); }} onReject={rejectCall} contacts={allContacts} />
      )}

      {showSettings && (
        <div className="absolute inset-0 bg-white z-50 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
            <button data-action="settings-back"
              onClick={() => settingsPage !== 'main' ? setSettingsPage('main') : setShowSettings(false)}
              className="text-gray-500 hover:text-gray-800 p-1 transition-colors"
            >
              <X size={20} />
            </button>
            <span className="font-semibold text-gray-900">
              {settingsPage === 'links' ? 'Saved Links' : settingsPage === 'templates' ? 'Message Templates' : 'Settings'}
            </span>
          </div>

          {settingsPage === 'main' && (
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4">
                <h3 className="text-gray-900 font-semibold mb-1">MyBiz Line</h3>
                <p className="text-gray-500 text-sm">Beta v0.1 · Your number: {MY_NUMBER_DISPLAY}</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <h3 className="text-gray-900 font-medium mb-3 text-sm">Business Profiles</h3>
                <div className="space-y-2">
                  {BUSINESSES.map(b => (
                    <div
                      key={b.id}
                      onClick={() => { setBiz(b); setShowSettings(false); }}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                        biz.id === b.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: b.color }} />
                      <span className={`text-sm font-medium ${biz.id === b.id ? 'text-blue-700' : 'text-gray-900'}`}>
                        {b.name}
                      </span>
                      {biz.id === b.id && <span className="ml-auto text-blue-600 text-xs font-medium">Active</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Text Size */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <h3 className="text-gray-900 font-medium mb-3 text-sm">Text Size</h3>
                <div className="flex gap-2">
                  {(['small', 'medium', 'large'] as const).map(size => (
                    <button
                      key={size}
                      data-action={`text-size-${size}`}
                      onClick={() => setTextSize(size)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium capitalize transition-colors ${
                        textSize === size
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {size === 'small' ? 'A' : size === 'medium' ? 'A' : 'A'}
                      <span className="block text-xs font-normal mt-0.5 capitalize">{size}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button data-action="open-saved-links"
                onClick={() => setSettingsPage('links')}
                className="w-full bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Link2 size={16} className="text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-gray-900 font-medium text-sm">Saved Links</div>
                  <div className="text-gray-500 text-xs">{links.length} link{links.length !== 1 ? 's' : ''}</div>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </button>

              <button data-action="open-template-settings"
                onClick={() => setSettingsPage('templates')}
                className="w-full bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-gray-900 font-medium text-sm">Message Templates</div>
                  <div className="text-gray-500 text-xs">{templates.length} template{templates.length !== 1 ? 's' : ''}</div>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </button>

              {/* System Diagnostics */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
                <h3 className="text-gray-900 font-medium text-sm">System Diagnostics</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Phone Device</span>
                    <span className={`font-mono ${diag.deviceState.includes('Ready') ? 'text-green-600' : diag.deviceState.includes('error') || diag.deviceState.includes('failed') ? 'text-red-600' : 'text-yellow-600'}`}>{diag.deviceState}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">AudioContext</span>
                    <span className="font-mono text-gray-700">{diag.audioContextState}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Token</span>
                    <span className={`font-mono ${diag.tokenOk === true ? 'text-green-600' : diag.tokenOk === false ? 'text-red-600' : 'text-gray-400'}`}>
                      {diag.tokenOk === true ? 'OK ✓' : diag.tokenOk === false ? 'Failed ✗' : 'Pending…'}
                    </span>
                  </div>
                  {diag.registeredAt && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Registered at</span>
                      <span className="font-mono text-green-600">{diag.registeredAt}</span>
                    </div>
                  )}
                  {diag.lastError && (
                    <div className="mt-2 p-2 bg-red-50 rounded-lg">
                      <p className="text-red-600 break-all">{diag.lastError}</p>
                    </div>
                  )}
                  {!diag.deviceState.includes('Ready') && !diag.lastError && (
                    <div className="mt-2 p-2 bg-blue-50 rounded-lg text-blue-700">
                      Tap anywhere on screen then go to Keypad → device will register
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <a href="/api/auth/logout" className="text-red-500 text-sm font-medium">Sign out</a>
              </div>
            </div>
          )}

          {settingsPage === 'templates' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-4 pb-3 bg-gray-50 border-b border-gray-200 space-y-2">
                <input
                  value={tplForm.name}
                  onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Template name (e.g. Follow Up)"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2 items-start">
                  <textarea
                    value={tplForm.body}
                    onChange={e => setTplForm(p => ({ ...p, body: e.target.value }))}
                    placeholder="Message text…"
                    rows={3}
                    className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                  />
                  <button data-action="add-template"
                    onClick={addTemplate}
                    disabled={!tplForm.name.trim() || !tplForm.body.trim()}
                    className="w-10 h-10 rounded-xl bg-blue-600 disabled:opacity-30 flex items-center justify-center flex-shrink-0 mt-0.5"
                  >
                    <Plus size={18} className="text-white" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {templates.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText size={36} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 text-sm">No templates yet</p>
                  </div>
                ) : (
                  templates.map((t, i) => (
                    <div key={i} className="p-3 bg-white border border-gray-200 rounded-2xl">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">{t.name}</span>
                        <button data-action="delete-template" onClick={() => deleteTemplate(i)} className="text-red-400 hover:text-red-600 p-1 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{t.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {settingsPage === 'links' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-4 pb-3 bg-gray-50 border-b border-gray-200 space-y-2">
                <input
                  value={linkForm.name}
                  onChange={e => setLinkForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Link name (e.g. Google Reviews)"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <input
                    value={linkForm.url}
                    onChange={e => setLinkForm(p => ({ ...p, url: e.target.value }))}
                    placeholder="https://..."
                    type="url"
                    className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                  <button data-action="add-link"
                    onClick={addLink}
                    disabled={!linkForm.name.trim() || !linkForm.url.trim()}
                    className="w-10 h-10 rounded-xl bg-blue-600 disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                  >
                    <Plus size={18} className="text-white" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {links.length === 0 ? (
                  <div className="text-center py-12">
                    <Link2 size={36} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 text-sm">No saved links yet</p>
                  </div>
                ) : (
                  links.map((link, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-2xl">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Link2 size={14} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{link.name}</div>
                        <div className="text-xs text-gray-500 truncate">{link.url}</div>
                      </div>
                      <button data-action="delete-link" onClick={() => deleteLink(i)} className="text-red-400 hover:text-red-600 p-1 transition-colors">
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

      {/* Profile Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 flex-shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
          style={{ background: biz.color }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-900 text-sm leading-tight">{biz.name}</div>
          <div className="text-gray-500 text-xs">{MY_NUMBER_DISPLAY}</div>
        </div>
        <div className="flex items-center gap-1">
          {isReady && !isOnCall && <span className="w-2 h-2 rounded-full bg-green-500 mr-1" title="Ready" />}
          {!isReady && <span className="text-xs text-gray-400 mr-1">Connecting…</span>}
          <select
            value={biz.id}
            onChange={e => setBiz(BUSINESSES.find(b => b.id === e.target.value) || BUSINESSES[0])}
            className="text-xs bg-gray-100 border-0 rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[110px]"
          >
            {BUSINESSES.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button data-action="open-settings"
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-100"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {isOnCall && (
          <div className="pt-4">
            <ActiveCall
              status={status}
              duration={duration}
              number={activeNumber}
              muted={muted}
              onHangup={hangup}
              onToggleMute={toggleMute}
              activeConn={connRef}
            />
          </div>
        )}

        {!isOnCall && (
          <>
            {tab === 'home' && (
              <div className="px-4 pt-5 pb-4 space-y-4">
                {BIZ_ROWS.map(row => {
                  const stats = dashStats[row.id as keyof DashStats] as BizStats;
                  return (
                    <div key={row.id} className={`rounded-2xl border ${row.border} ${row.bg} p-3`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                        <span className={`text-xs font-semibold ${row.text}`}>{row.name}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button data-action="open-messages"
                          onClick={() => setTab('messages')}
                          className="bg-white rounded-xl p-3 text-left shadow-sm border border-white hover:border-blue-200 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <MessageSquare size={13} className="text-blue-500" />
                            <span className="text-xs text-gray-500">Unread</span>
                          </div>
                          <div className="text-xl font-bold text-gray-900">{stats.unread}</div>
                        </button>
                        <button data-action="open-recents"
                          onClick={() => { setTab('dialpad'); setDialpadView('recents'); }}
                          className="bg-white rounded-xl p-3 text-left shadow-sm border border-white hover:border-red-200 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <PhoneMissed size={13} className="text-red-400" />
                            <span className="text-xs text-gray-500">Missed</span>
                          </div>
                          <div className="text-xl font-bold text-gray-900">{stats.missed}</div>
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button data-action="open-tasks"
                  onClick={() => setTab('tasks')}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-3 text-left hover:bg-green-50 hover:border-green-200 transition-colors shadow-sm flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                    <CheckSquare size={18} className="text-green-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{dashStats.tasks}</div>
                    <div className="text-xs text-gray-500">Open Tasks</div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 ml-auto" />
                </button>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900 text-sm">Recent</span>
                    <button data-action="open-messages" onClick={() => setTab('messages')} className="text-blue-600 text-xs font-medium">See all</button>
                  </div>
                  {recentConvos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">No messages yet</div>
                  ) : (
                    <div className="space-y-1 bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                      {recentConvos.map((c: any, i: number) => {
                        const bizRow = BIZ_ROWS.find(b => b.id === c.bizId) || BIZ_ROWS[2];
                        const isPersonal = c.bizId === 'personal';
                        return (
                          <div
                            key={c.number}
                            onClick={() => { setSmsContact(c.number); setTab('messages'); }}
                            className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${i < recentConvos.length - 1 ? 'border-b border-gray-100' : ''}`}
                          >
                            <div className="relative flex-shrink-0">
                              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                                <span className="text-blue-700 font-semibold text-sm">{c.number.slice(-4, -3) || '?'}</span>
                              </div>
                              <span
                                className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
                                style={{ background: isPersonal ? '#374151' : bizRow.color }}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-semibold truncate ${c.unread ? 'text-gray-900' : 'text-gray-700'}`}>{c.number}</div>
                              <div className="text-xs text-gray-500 truncate">{c.lastMsg}</div>
                            </div>
                            {c.unread > 0 && (
                              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{c.unread}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-semibold text-gray-900 text-sm mb-3">Quick Dial</div>
                  <button data-action="open-keypad"
                    onClick={() => { setTab('dialpad'); setDialpadView('keypad'); }}
                    className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-2xl hover:bg-blue-50 hover:border-blue-200 transition-colors shadow-sm"
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center">
                      <Phone size={18} className="text-white" />
                    </div>
                    <span className="text-gray-900 font-medium text-sm">Open Dial Pad</span>
                    <ChevronRight size={16} className="text-gray-400 ml-auto" />
                  </button>
                </div>
              </div>
            )}

            {tab === 'dialpad' && (
              <div className="flex flex-col">
                {/* Keypad / Recents toggle */}
                <div className="flex items-center gap-1 mx-4 mt-4 mb-2 bg-gray-100 rounded-xl p-1 sticky top-0 z-10">
                  <button data-action="show-keypad"
                    onClick={() => setDialpadView('keypad')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dialpadView === 'keypad' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Keypad
                  </button>
                  <button data-action="show-recents"
                    onClick={() => setDialpadView('recents')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dialpadView === 'recents' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Recents
                  </button>
                </div>
                {dialpadView === 'keypad' ? (
                  <div className="px-4">
                    <Dialpad onCall={handleCall} disabled={isOnCall} isReady={isReady} />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <CallLog onCall={handleCall} onSMS={handleSMS} contacts={allContacts} onSaveContact={(phone) => { setContactPrefill({ phone }); setTab('contacts'); }} />
                  </div>
                )}
              </div>
            )}
            {tab === 'messages' && (
              smsContact ? (
                <div className="flex flex-col" style={{ height: 'calc(100vh - 132px)' }}>
                  <SMSThread
                    number={smsContact}
                    onBack={() => setSmsContact(null)}
                    onCall={handleCall}
                    onAddContact={handleAddContact}
                    contacts={allContacts}
                  />
                </div>
              ) : (
                <div className="relative">
                  <SMSInbox onSelect={n => setSmsContact(n)} contacts={allContacts} />
                  <button data-action="new-message"
                    onClick={() => {
                      const num = prompt('Enter phone number:');
                      if (num) setSmsContact(num.startsWith('+') ? num : `+1${num.replace(/\D/g, '')}`);
                    }}
                    className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-blue-600 shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors z-10"
                  >
                    <PenSquare size={22} className="text-white" />
                  </button>
                </div>
              )
            )}
            {tab === 'groups' && (
              <div className="flex flex-col h-full">
                {activeGroup ? (
                  <GroupThread
                    group={activeGroup}
                    contacts={contacts}
                    onBack={() => setActiveGroup(null)}
                  />
                ) : (
                  <GroupInbox
                    contacts={contacts}
                    onSelect={(g) => setActiveGroup(g)}
                  />
                )}
              </div>
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
            {tab === 'voicemail' && (
              <Voicemail
                contacts={allContacts}
                activeBusiness={biz.id}
                onCall={handleCall}
                onSMS={handleSMS}
              />
            )}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="flex bg-white border-t border-gray-100 flex-shrink-0 safe-area-pb px-2 py-2">
        {([
          { id: 'home', icon: Home, label: 'Home' },
          { id: 'messages', icon: MessageSquare, label: 'Messages' },
          { id: 'dialpad', icon: Grid3x3, label: 'Keypad' },
          { id: 'groups', icon: Users, label: 'Groups' },
          { id: 'contacts', icon: Users, label: 'Contacts' },
          { id: 'voicemail', icon: VoicemailIcon, label: 'Voicemail' },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button data-action="nav-tab"
            key={id}
            onClick={() => {
              setTab(id);
              if (id !== 'messages') setSmsContact(null);
              if (id !== 'groups') setActiveGroup(null);
            }}
            className="flex-1 flex flex-col items-center transition-colors"
          >
            <div className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-2xl transition-colors ${
              tab === id ? 'bg-blue-50' : ''
            }`}>
              <Icon size={20} className={tab === id ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`text-[10px] font-medium ${tab === id ? 'text-blue-600' : 'text-gray-400'}`}>{label}</span>
            </div>
          </button>
        ))}
        <button
          data-action="open-settings"
          onClick={() => setShowSettings(true)}
          className="flex-1 flex flex-col items-center transition-colors"
        >
          <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-2xl transition-colors">
            <Settings size={20} className="text-gray-400" />
            <span className="text-[10px] font-medium text-gray-400">Settings</span>
          </div>
        </button>
      </div>
    </div>
  );
}
